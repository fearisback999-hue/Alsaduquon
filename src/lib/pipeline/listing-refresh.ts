import { db } from "@/lib/db";
import { listings, listingMetrics, printifyProducts, designConcepts, niches } from "@/lib/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { generatePlatformTitleVariants, generatePlatformDescription, generatePlatformTags, calculateSEOScore } from "@/lib/seo/platform-seo";
import { optimizeEtsyListing } from "@/lib/seo/etsy-optimizer";
import { getPlatform } from "@/lib/platforms/registry";
import { UnsupportedPlatformOperation, type PlatformId } from "@/lib/platforms/types";
import { getProductDisplayName } from "@/lib/printify/product-config";
import { log } from "@/lib/logger";

interface RefreshResult {
  refreshed: number;
  skipped: number;
  failed: number;
}

const MAX_REFRESH_PER_RUN = 5;
const MIN_DAYS_DEACTIVATED = 14;

/**
 * Refreshes deactivated listings with new titles, descriptions, and tags.
 * Instead of losing dead inventory, we give it a second life with fresh
 * SEO copy. The design stays the same — if it was good enough to publish
 * once, it can sell with better positioning.
 */
export async function refreshDeactivatedListings(): Promise<RefreshResult> {
  const result: RefreshResult = { refreshed: 0, skipped: 0, failed: 0 };

  const cutoff = new Date(Date.now() - MIN_DAYS_DEACTIVATED * 24 * 60 * 60 * 1000).toISOString();

  const candidates = await db
    .select({
      listingId: listings.id,
      platform: listings.platform,
      externalListingId: listings.externalListingId,
      printifyProductId: listings.printifyProductId,
      title: listings.title,
      basePrice: listings.basePrice,
      finalPrice: listings.finalPrice,
      updatedAt: listings.updatedAt,
    })
    .from(listings)
    .where(and(eq(listings.status, "deactivated"), lt(listings.updatedAt, cutoff)))
    .limit(MAX_REFRESH_PER_RUN)
    .all();

  for (const candidate of candidates) {
    if (!candidate.printifyProductId || !candidate.externalListingId) {
      result.skipped++;
      continue;
    }

    const platform = getPlatform(candidate.platform as PlatformId);
    if (!platform) {
      result.skipped++;
      continue;
    }

    const product = await db
      .select()
      .from(printifyProducts)
      .where(eq(printifyProducts.id, candidate.printifyProductId))
      .get();
    if (!product) {
      result.skipped++;
      continue;
    }

    const concept = await db
      .select()
      .from(designConcepts)
      .where(eq(designConcepts.id, product.designConceptId))
      .get();
    const niche = concept
      ? await db.select().from(niches).where(eq(niches.id, concept.nicheId)).get()
      : null;

    if (!concept || !niche) {
      result.skipped++;
      continue;
    }

    // Don't refresh listings in exhausted/saturated niches
    if (niche.status === "exhausted" || niche.status === "saturated") {
      result.skipped++;
      continue;
    }

    try {
      const seoHints = platform.getSEOHints();
      const productDisplayName = getProductDisplayName(product.productType);
      // Same real marketplace signals the initial listing used (Step 8) so the
      // refreshed copy targets actual buyer search terms instead of free-
      // associating — otherwise the "second life" rewrite throws away the one
      // edge it has over the dead original.
      const marketData = {
        searchVolume: niche.searchVolume,
        competitionLevel: niche.competitionLevel,
        trendDirection: niche.trendDirection,
      };

      const [titleVariants, description, rawTags] = await Promise.all([
        generatePlatformTitleVariants(niche.name, concept.title, productDisplayName, seoHints, undefined, marketData),
        generatePlatformDescription(niche.name, concept.title, concept.description ?? "", productDisplayName, seoHints, undefined, marketData),
        generatePlatformTags(niche.name, concept.title, productDisplayName, seoHints, undefined, marketData),
      ]);

      // Same deterministic Etsy-SEO finishing pass the initial listing gets
      // (step-08) so a refreshed listing is held to the identical standard.
      const seo = optimizeEtsyListing({
        niche: niche.name,
        conceptTitle: concept.title,
        productType: productDisplayName,
        titleVariants,
        tags: rawTags,
        buyerPersona: niche.buyerPersona,
        occasion: niche.occasion,
        maxTitleLength: seoHints.titleMaxLength,
        maxTags: seoHints.maxTags,
        maxTagLength: seoHints.tagMaxLength,
      });
      const newTitle = seo.title;
      const tags = seo.tags;
      const seoScore = calculateSEOScore(newTitle, description, tags, seoHints);

      // Update title on the platform
      try {
        await platform.updateTitle(candidate.externalListingId, newTitle);
      } catch (err) {
        if (err instanceof UnsupportedPlatformOperation) {
          log("info", `[listing-refresh] Cannot update title on ${candidate.platform}, skipping`);
          result.skipped++;
          continue;
        }
        throw err;
      }

      // Re-publish the listing
      try {
        await platform.publishListing(candidate.externalListingId);
      } catch (err) {
        log("error", `[listing-refresh] Failed to re-publish on ${candidate.platform}`, {
          error: err instanceof Error ? err.message : String(err),
        });
        result.failed++;
        continue;
      }

      await db.update(listings).set({
        title: newTitle,
        titleVariants: seo.titleVariants.length > 1 ? JSON.stringify(seo.titleVariants) : null,
        titleVariantIndex: 0,
        description,
        tags: JSON.stringify(tags),
        seoScore,
        status: "published",
        externalState: "active",
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(listings.id, candidate.listingId));

      // Reset metrics for the refreshed listing
      const existingMetrics = await db
        .select()
        .from(listingMetrics)
        .where(eq(listingMetrics.listingId, candidate.listingId))
        .get();

      if (existingMetrics) {
        await db.update(listingMetrics).set({
          views: 0,
          favorites: 0,
          sales: 0,
          conversionRate: 0,
          syncedAt: new Date().toISOString(),
        }).where(eq(listingMetrics.id, existingMetrics.id));
      }

      log("info", `[listing-refresh] Refreshed "${candidate.title}" → "${newTitle}" on ${candidate.platform}`);
      result.refreshed++;
    } catch (error) {
      log("error", `[listing-refresh] Failed to refresh listing ${candidate.listingId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed++;
    }
  }

  return result;
}
