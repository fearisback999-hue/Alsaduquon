import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listings, listingMetrics, printifyProducts, designConcepts, niches } from "@/lib/db/schema";
import { eq, and, sql, lt, gt } from "drizzle-orm";
import { chatCompletion } from "@/lib/ai/client";
import { ListingOptimizationSchema } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import * as etsy from "@/lib/external/etsy";
import { log } from "@/lib/logger";
import { verifyCronSecret } from "@/lib/auth/cron-auth";
import { runRepricing } from "@/lib/pricing/optimizer";
import { rotateTitleVariants } from "@/lib/pricing/title-rotator";
import { rotateDescriptionTagVariants } from "@/lib/pricing/description-tag-rotator";
import { amplifyWinningNiches } from "@/lib/pipeline/winner-amplification";
import { pruneDeadNiches, pruneSaturatedNiches } from "@/lib/pipeline/niche-pruning";
import { expandWinningProducts } from "@/lib/pipeline/winner-product-expansion";
import { refreshDeactivatedListings } from "@/lib/pipeline/listing-refresh";
import { scrapeCompetitorPricing } from "@/lib/analytics/competitor-scraper";
import { autoPausePipeline } from "@/lib/pipeline/payment-guard";
import { detectMarginDrift } from "@/lib/pricing/margin-monitor";
import { recommendDailyListingLimit } from "@/lib/pipeline/listing-limit-advisor";
import { sendOperationalAlert } from "@/lib/notifications";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_OPTIMIZE_PER_RUN = 10;

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  try {
    // Pre-flight: check payment health and auto-pause if problems detected
    const paymentCheck = await autoPausePipeline();
    if (paymentCheck.paused) {
      log("warn", `Optimize cron skipped: pipeline auto-paused due to payment issues — ${paymentCheck.reason}`);
      return NextResponse.json({
        success: false,
        warning: "Pipeline auto-paused due to payment health issues",
        reason: paymentCheck.reason,
      });
    }

    let optimized = 0;
    let deactivated = 0;

    // Phase 1: Dynamic repricing based on listing performance metrics
    const repricingResult = await runRepricing();
    log("info", `Repricing: ${repricingResult.adjusted} adjusted (${repricingResult.raised} raised, ${repricingResult.lowered} lowered), ${repricingResult.skipped} skipped`);

    // Phase 2: Amplify winning niches — re-approve niches with proven sales
    // so the next pipeline run generates more concepts in them.
    const amplificationResult = await amplifyWinningNiches();
    log("info", `Amplification: re-approved ${amplificationResult.amplified} winning niches for follow-up designs`);

    // Phase 3: Prune dead niches — mark niches as exhausted if they've had
    // 3+ listings for 45+ days with zero sales and minimal engagement.
    // Stops wasting future pipeline budget on proven losers.
    const pruningResult = await pruneDeadNiches();
    log("info", `Pruning: marked ${pruningResult.exhausted} niches as exhausted`);

    // Phase 3b: Pause saturated niches — high traffic but anemic conversion
    // means we're competing in too crowded a market. Frees budget for fresh niches.
    const saturationResult = await pruneSaturatedNiches();
    log("info", `Saturation: paused ${saturationResult.exhausted} saturated niches`);

    // Phase 3c: Expand winning designs to additional product types.
    // A bestselling t-shirt design becomes a hoodie, mug, sticker, etc.
    const expansionResult = await expandWinningProducts();
    log("info", `Product expansion: ${expansionResult.expanded} new products from winners (${expansionResult.failed} failed, ${expansionResult.skipped} skipped)`);

    // Phase 4: Refresh deactivated zombie listings with new SEO copy and
    // re-publish. Recycles dead inventory instead of losing it.
    const refreshResult = await refreshDeactivatedListings();
    log("info", `Listing refresh: ${refreshResult.refreshed} re-published, ${refreshResult.failed} failed, ${refreshResult.skipped} skipped`);

    // Phase 5: Rotate A/B title variants on listings that have been live on
    // their current variant for the rotation interval (14 days).
    const titleRotation = await rotateTitleVariants();
    log("info", `Title rotation: rotated ${titleRotation.rotated}, finalized ${titleRotation.finalized} of ${titleRotation.evaluated} eligible`);

    // Phase 6: Rotate A/B description and tag variants on listings that have
    // been live on their current variant for the rotation interval (14 days).
    const descriptionTagRotation = await rotateDescriptionTagVariants();
    log("info", `Description/tag rotation: rotated ${descriptionTagRotation.rotated}, finalized ${descriptionTagRotation.finalized} of ${descriptionTagRotation.evaluated} eligible`);

    // Phase 7: Scrape competitor pricing from Etsy for active niches.
    // Tracks top-seller prices, favorites, and sales to inform our pricing strategy.
    const competitorScrape = await scrapeCompetitorPricing();
    log("info", `Competitor scrape: ${competitorScrape.nichesScraped} niches, ${competitorScrape.listingsScraped} listings, avg price $${competitorScrape.avgPrice}`);

    // Phase 8: Margin-drift monitor — recompute every live listing's margin
    // against today's costs and alert on any that have slipped below target.
    // Read-only: catches Printify price hikes before they erode profit at scale.
    const marginDrift = await detectMarginDrift();
    log("info", `Margin monitor: checked ${marginDrift.checked} listings, ${marginDrift.drifted.length} below target (worst ${marginDrift.worstMarginPct ?? "n/a"}%)`);
    if (marginDrift.drifted.length > 0) {
      const sample = marginDrift.drifted.slice(0, 5)
        .map((d) => `"${d.title}" (${d.productType}) ${d.currentMarginPct}% vs ${d.targetMarginPct}% target`)
        .join("; ");
      await sendOperationalAlert(
        "margin_drift",
        `${marginDrift.drifted.length} listing(s) below margin target — worst ${marginDrift.worstMarginPct}%. Review pricing or deactivate. Examples: ${sample}`,
        { count: marginDrift.drifted.length, worstMarginPct: marginDrift.worstMarginPct },
      );
    }

    // Phase 9: Safe listing-limit advisory — recommend (never auto-apply) a
    // ban-safe max_daily_listings as the shop ages, so the catalog can grow
    // toward volume without tripping Etsy's new-shop throttles.
    const limitAdvice = await recommendDailyListingLimit();
    log("info", `Listing-limit advisor: ${limitAdvice.reason}`);
    if (limitAdvice.canIncrease) {
      await sendOperationalAlert("listing_limit_advice", limitAdvice.reason, {
        shopAgeDays: limitAdvice.shopAgeDays,
        currentLimit: limitAdvice.currentLimit,
        recommendedLimit: limitAdvice.recommendedLimit,
      });
    }

    // Find underperforming listings:
    // Published 14+ days ago, has views but low conversion (<1%)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const underperformers = await db
      .select({
        listingId: listings.id,
        externalListingId: listings.externalListingId,
        title: listings.title,
        description: listings.description,
        tags: listings.tags,
        views: listingMetrics.views,
        sales: listingMetrics.sales,
        conversionRate: listingMetrics.conversionRate,
        productType: printifyProducts.productType,
        nicheName: niches.name,
      })
      .from(listings)
      .innerJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
      .innerJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
      .innerJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
      .where(
        and(
          eq(listings.status, "published"),
          eq(listings.platform, "etsy"),
          lt(listings.publishedAt, fourteenDaysAgo),
          gt(listingMetrics.views, 20),
          lt(listingMetrics.conversionRate, 1.0),
        ),
      )
      .limit(MAX_OPTIMIZE_PER_RUN)
      .all();

    for (const listing of underperformers) {
      // Deactivate zombie listings (100+ views, 0 sales after 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
      if ((listing.views ?? 0) > 100 && (listing.sales ?? 0) === 0) {
        // Check if published > 30 days ago
        const fullListing = await db.select().from(listings).where(eq(listings.id, listing.listingId)).get();
        if (fullListing?.publishedAt && fullListing.publishedAt < thirtyDaysAgo) {
          log("info", `Deactivating zombie listing: ${listing.title} (${listing.views} views, 0 sales)`);
          try {
            if (fullListing.externalListingId) {
              await etsy.updateListing(parseInt(fullListing.externalListingId), { state: "inactive" });
            }
            await db.update(listings).set({
              status: "deactivated",
              updatedAt: new Date().toISOString(),
            }).where(eq(listings.id, fullListing.id));
          } catch (err) {
            log("error", `Failed to deactivate listing ${listing.title}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
          deactivated++;
          continue;
        }
      }

      try {
        await enforcebudget(0.02);

        // Generate improved title and tags
        const currentTags = (() => { try { return JSON.parse(listing.tags ?? "[]"); } catch { return []; } })();

        const prompt = `This Etsy listing has ${listing.views} views but only ${listing.sales ?? 0} sales (${(listing.conversionRate ?? 0).toFixed(1)}% conversion). Help improve it.

Current title: "${listing.title}"
Current tags: ${currentTags.join(", ")}
Niche: "${listing.nicheName}"
Product: "${listing.productType}"

Generate an improved title (max 140 chars) and 13 tags that:
- Front-load high-converting buyer keywords
- Include long-tail search terms
- Remove generic/low-value tags
- Add urgency or emotional appeal where appropriate
- Target specific buyer personas

Return JSON:
{
  "new_title": "...",
  "new_tags": ["tag1", "tag2", ...],
  "changes_reasoning": "<1 sentence explaining what you changed and why>"
}`;

        const result = await chatCompletion(prompt, {
          systemPrompt: "You are an Etsy SEO optimization expert. Your changes consistently improve listing conversion rates by 30-50%. Focus on buyer intent keywords, not just search volume.",
          maxTokens: 400,
          temperature: 0.5,
          schema: ListingOptimizationSchema,
          schemaName: "listing_optimization",
        });

        await trackTextUsage({
          model: result.model,
          operation: "listing_optimization",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
        });

        const optimization = result.parsed!;
        const newTitle = optimization.new_title.slice(0, 140);
        const newTags = optimization.new_tags.slice(0, 13);

        if (newTitle && newTags.length > 0 && listing.externalListingId) {
          // Update on Etsy
          await etsy.updateListing(parseInt(listing.externalListingId), {
            title: newTitle,
            tags: newTags,
          });

          // Update in our DB
          await db.update(listings).set({
            title: newTitle,
            tags: JSON.stringify(newTags),
            updatedAt: new Date().toISOString(),
          }).where(eq(listings.id, listing.listingId));

          log("info", `Optimized listing: "${listing.title}" → "${newTitle}" (${optimization.changes_reasoning})`);
          optimized++;
        }
      } catch (error) {
        log("error", `Failed to optimize listing ${listing.listingId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return NextResponse.json({
      success: true,
      underperformersFound: underperformers.length,
      optimized,
      deactivated,
      repricing: repricingResult,
      amplification: amplificationResult,
      pruning: { exhausted: pruningResult.exhausted },
      saturation: { paused: saturationResult.exhausted },
      productExpansion: expansionResult,
      listingRefresh: refreshResult,
      titleRotation,
      descriptionTagRotation,
      competitorScrape,
      marginDrift: { checked: marginDrift.checked, flagged: marginDrift.drifted.length, worstMarginPct: marginDrift.worstMarginPct },
      listingLimitAdvice: limitAdvice,
    });
  } catch (error) {
    log("error", "Optimization cron failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Optimization failed" }, { status: 500 });
  }
}
