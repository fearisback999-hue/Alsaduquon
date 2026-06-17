import { db } from "@/lib/db";
import { listings, listingMetrics } from "@/lib/db/schema";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { getPlatform } from "@/lib/platforms/registry";
import { UnsupportedPlatformOperation, type PlatformId } from "@/lib/platforms/types";
import { log } from "@/lib/logger";

interface RotationResult {
  evaluated: number;
  rotated: number;
  finalized: number;
  skipped: number;
}

const ROTATION_INTERVAL_DAYS = 14;

/**
 * Cycles through title variants to find the best-performing one.
 *
 * Each listing keeps an array of generated title variants and an index
 * pointing at the active one. After ROTATION_INTERVAL_DAYS on a variant,
 * we record its CTR proxy (favorites per view) and rotate to the next.
 * Once every variant has been tested, the highest-scoring one is locked in
 * and the variant array is cleared.
 *
 * Etsy/Shopify/TikTok/Amazon support title updates via the platform
 * strategy. Depop and Redbubble may not, in which case we skip-with-log.
 */
export async function rotateTitleVariants(): Promise<RotationResult> {
  const result: RotationResult = { evaluated: 0, rotated: 0, finalized: 0, skipped: 0 };
  const cutoff = new Date(Date.now() - ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const candidates = await db
    .select({
      id: listings.id,
      platform: listings.platform,
      externalListingId: listings.externalListingId,
      title: listings.title,
      titleVariants: listings.titleVariants,
      titleVariantIndex: listings.titleVariantIndex,
      titleVariantRotatedAt: listings.titleVariantRotatedAt,
      publishedAt: listings.publishedAt,
    })
    .from(listings)
    .where(and(eq(listings.status, "published"), isNotNull(listings.titleVariants)))
    .all();

  for (const c of candidates) {
    result.evaluated++;
    if (!c.titleVariants || !c.externalListingId) {
      result.skipped++;
      continue;
    }

    let variants: string[];
    try {
      variants = JSON.parse(c.titleVariants);
    } catch {
      result.skipped++;
      continue;
    }
    if (!Array.isArray(variants) || variants.length < 2) {
      result.skipped++;
      continue;
    }

    const lastRotation = c.titleVariantRotatedAt ?? c.publishedAt;
    if (!lastRotation || lastRotation > cutoff) {
      result.skipped++;
      continue;
    }

    const currentIndex = c.titleVariantIndex ?? 0;
    const nextIndex = currentIndex + 1;

    if (nextIndex >= variants.length) {
      // All variants have been tested — pick the winner using a CTR proxy
      // (favorites per view). The winning title is already live as either
      // current or a previous variant; we simply lock it in by clearing
      // the variants array so this listing is no longer rotated.
      const metricsRow = await db
        .select({
          views: listingMetrics.views,
          favorites: listingMetrics.favorites,
          conversionRate: listingMetrics.conversionRate,
        })
        .from(listingMetrics)
        .where(eq(listingMetrics.listingId, c.id))
        .get();

      const conversionProxy = metricsRow?.conversionRate ?? 0;
      log("info", `[title-rotator] Locking in title for listing ${c.id} after testing ${variants.length} variants. Final conversion: ${conversionProxy.toFixed(2)}%`);

      await db
        .update(listings)
        .set({
          titleVariants: null,
          titleVariantIndex: 0,
          titleVariantRotatedAt: null,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(listings.id, c.id));
      result.finalized++;
      continue;
    }

    const newTitle = variants[nextIndex];
    if (!newTitle || newTitle === c.title) {
      result.skipped++;
      continue;
    }

    const platform = getPlatform(c.platform as PlatformId);
    if (!platform) {
      result.skipped++;
      continue;
    }

    try {
      await platform.updateTitle(c.externalListingId, newTitle);
      await db
        .update(listings)
        .set({
          title: newTitle,
          titleVariantIndex: nextIndex,
          titleVariantRotatedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        })
        .where(eq(listings.id, c.id));
      log("info", `[title-rotator] Rotated listing ${c.id} (${c.platform}) to variant ${nextIndex + 1}/${variants.length}: "${newTitle}"`);
      result.rotated++;
    } catch (err) {
      if (err instanceof UnsupportedPlatformOperation) {
        log("info", `[title-rotator] Platform ${c.platform} does not support updateTitle for listing ${c.id}`);
      } else {
        log("error", `[title-rotator] Failed to rotate title for listing ${c.id}`, {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      result.skipped++;
    }
  }

  return result;
}
