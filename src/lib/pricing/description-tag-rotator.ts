import { db } from "@/lib/db";
import { listings, listingMetrics } from "@/lib/db/schema";
import { eq, and, isNotNull, or } from "drizzle-orm";
import { log } from "@/lib/logger";

interface RotationResult {
  evaluated: number;
  rotated: number;
  finalized: number;
  skipped: number;
}

const ROTATION_INTERVAL_DAYS = 14;

/**
 * Cycles through description and tag variants to find the best-performing
 * combination.
 *
 * Shares the same rotation timestamp as title rotation
 * (`titleVariantRotatedAt`) so all A/B content rotates in lock-step.
 * After ROTATION_INTERVAL_DAYS on a variant, we advance the index.
 * Once every variant has been tested, the highest-scoring one is locked in
 * and the variant arrays are cleared.
 *
 * Descriptions and tags are updated in the DB only — most platforms don't
 * expose API methods for updating description/tag fields post-publish.
 */
export async function rotateDescriptionTagVariants(): Promise<RotationResult> {
  const result: RotationResult = { evaluated: 0, rotated: 0, finalized: 0, skipped: 0 };
  const cutoff = new Date(Date.now() - ROTATION_INTERVAL_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const candidates = await db
    .select({
      id: listings.id,
      platform: listings.platform,
      description: listings.description,
      descriptionVariants: listings.descriptionVariants,
      descriptionVariantIndex: listings.descriptionVariantIndex,
      tags: listings.tags,
      tagVariants: listings.tagVariants,
      tagVariantIndex: listings.tagVariantIndex,
      titleVariantRotatedAt: listings.titleVariantRotatedAt,
      publishedAt: listings.publishedAt,
    })
    .from(listings)
    .where(
      and(
        eq(listings.status, "published"),
        or(isNotNull(listings.descriptionVariants), isNotNull(listings.tagVariants)),
      ),
    )
    .all();

  for (const c of candidates) {
    result.evaluated++;

    const lastRotation = c.titleVariantRotatedAt ?? c.publishedAt;
    if (!lastRotation || lastRotation > cutoff) {
      result.skipped++;
      continue;
    }

    let didRotate = false;
    const updates: Record<string, unknown> = { updatedAt: new Date().toISOString() };

    // --- Description rotation ---
    if (c.descriptionVariants) {
      let descVariants: string[];
      try {
        descVariants = JSON.parse(c.descriptionVariants);
      } catch {
        descVariants = [];
      }

      if (Array.isArray(descVariants) && descVariants.length >= 2) {
        const currentIdx = c.descriptionVariantIndex ?? 0;
        const nextIdx = currentIdx + 1;

        if (nextIdx >= descVariants.length) {
          // All description variants tested — finalize by locking current and clearing
          const metricsRow = await db
            .select({
              conversionRate: listingMetrics.conversionRate,
            })
            .from(listingMetrics)
            .where(eq(listingMetrics.listingId, c.id))
            .get();

          const conversionProxy = metricsRow?.conversionRate ?? 0;
          log("info", `[desc-tag-rotator] Locking description for listing ${c.id} after testing ${descVariants.length} variants. Conversion: ${conversionProxy.toFixed(2)}%`);

          updates.descriptionVariants = null;
          updates.descriptionVariantIndex = 0;
        } else {
          const newDescription = descVariants[nextIdx];
          if (newDescription && newDescription !== c.description) {
            updates.description = newDescription;
            updates.descriptionVariantIndex = nextIdx;
            didRotate = true;
            log("info", `[desc-tag-rotator] Rotated description for listing ${c.id} (${c.platform}) to variant ${nextIdx + 1}/${descVariants.length}`);
          }
        }
      }
    }

    // --- Tag rotation ---
    if (c.tagVariants) {
      let tagVariants: string[][];
      try {
        tagVariants = JSON.parse(c.tagVariants);
      } catch {
        tagVariants = [];
      }

      if (Array.isArray(tagVariants) && tagVariants.length >= 2) {
        const currentIdx = c.tagVariantIndex ?? 0;
        const nextIdx = currentIdx + 1;

        if (nextIdx >= tagVariants.length) {
          // All tag variants tested — finalize
          const metricsRow = await db
            .select({
              conversionRate: listingMetrics.conversionRate,
            })
            .from(listingMetrics)
            .where(eq(listingMetrics.listingId, c.id))
            .get();

          const conversionProxy = metricsRow?.conversionRate ?? 0;
          log("info", `[desc-tag-rotator] Locking tags for listing ${c.id} after testing ${tagVariants.length} variants. Conversion: ${conversionProxy.toFixed(2)}%`);

          updates.tagVariants = null;
          updates.tagVariantIndex = 0;
        } else {
          const newTags = tagVariants[nextIdx];
          if (Array.isArray(newTags) && newTags.length > 0) {
            const currentTags = c.tags;
            const newTagsJson = JSON.stringify(newTags);
            if (newTagsJson !== currentTags) {
              updates.tags = newTagsJson;
              updates.tagVariantIndex = nextIdx;
              didRotate = true;
              log("info", `[desc-tag-rotator] Rotated tags for listing ${c.id} (${c.platform}) to variant ${nextIdx + 1}/${tagVariants.length}`);
            }
          }
        }
      }
    }

    // Update the shared rotation timestamp when rotating
    if (didRotate) {
      updates.titleVariantRotatedAt = new Date().toISOString();
    }

    // Check if we finalized anything (variants cleared)
    const didFinalize = updates.descriptionVariants === null || updates.tagVariants === null;

    // Apply updates if we have anything beyond just updatedAt
    if (Object.keys(updates).length > 1) {
      await db
        .update(listings)
        .set(updates)
        .where(eq(listings.id, c.id));

      if (didRotate) {
        result.rotated++;
      }
      if (didFinalize && !didRotate) {
        result.finalized++;
      } else if (didFinalize && didRotate) {
        // Edge case: one type rotated, other finalized in same pass
        result.finalized++;
      }
    } else {
      result.skipped++;
    }
  }

  return result;
}
