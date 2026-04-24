import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { etsyListings, listingMetrics, printifyProducts, designConcepts, niches } from "@/lib/db/schema";
import { eq, and, sql, lt, gt } from "drizzle-orm";
import { chatCompletion } from "@/lib/ai/client";
import { ListingOptimizationSchema } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import * as etsy from "@/lib/external/etsy";
import { log } from "@/lib/logger";
import { verifyCronSecret } from "@/lib/auth/cron-auth";
import { runRepricing } from "@/lib/pricing/optimizer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const MAX_OPTIMIZE_PER_RUN = 10;

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  try {
    let optimized = 0;
    let deactivated = 0;

    // Phase 1: Dynamic repricing based on listing performance metrics
    const repricingResult = await runRepricing();
    log("info", `Repricing: ${repricingResult.adjusted} adjusted (${repricingResult.raised} raised, ${repricingResult.lowered} lowered), ${repricingResult.skipped} skipped`);

    // Find underperforming listings:
    // Published 14+ days ago, has views but low conversion (<1%)
    const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

    const underperformers = await db
      .select({
        listingId: etsyListings.id,
        etsyListingId: etsyListings.etsyListingId,
        title: etsyListings.title,
        description: etsyListings.description,
        tags: etsyListings.tags,
        views: listingMetrics.views,
        sales: listingMetrics.sales,
        conversionRate: listingMetrics.conversionRate,
        productType: printifyProducts.productType,
        nicheName: niches.name,
      })
      .from(etsyListings)
      .innerJoin(listingMetrics, eq(listingMetrics.etsyListingId, etsyListings.id))
      .innerJoin(printifyProducts, eq(etsyListings.printifyProductId, printifyProducts.id))
      .innerJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
      .where(
        and(
          eq(etsyListings.status, "published"),
          lt(etsyListings.publishedAt, fourteenDaysAgo),
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
        const fullListing = await db.select().from(etsyListings).where(eq(etsyListings.id, listing.listingId)).get();
        if (fullListing?.publishedAt && fullListing.publishedAt < thirtyDaysAgo) {
          log("info", `Deactivating zombie listing: ${listing.title} (${listing.views} views, 0 sales)`);
          try {
            if (fullListing.etsyListingId) {
              await etsy.updateListing(parseInt(fullListing.etsyListingId), { state: "inactive" });
            }
            await db.update(etsyListings).set({
              status: "deactivated",
              updatedAt: new Date().toISOString(),
            }).where(eq(etsyListings.id, fullListing.id));
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

        if (newTitle && newTags.length > 0 && listing.etsyListingId) {
          // Update on Etsy
          await etsy.updateListing(parseInt(listing.etsyListingId), {
            title: newTitle,
            tags: newTags,
          });

          // Update in our DB
          await db.update(etsyListings).set({
            title: newTitle,
            tags: JSON.stringify(newTags),
            updatedAt: new Date().toISOString(),
          }).where(eq(etsyListings.id, listing.listingId));

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
    });
  } catch (error) {
    log("error", "Optimization cron failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Optimization failed" }, { status: 500 });
  }
}
