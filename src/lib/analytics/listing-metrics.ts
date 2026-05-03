import { db } from "@/lib/db";
import { listings, listingMetrics, orders } from "@/lib/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { getEnabledPlatforms } from "@/lib/platforms/registry";
import { UnsupportedPlatformOperation } from "@/lib/platforms/types";
import { log } from "@/lib/logger";

interface PlatformSyncResult {
  synced: number;
  failed: number;
  skipped: boolean;
}

/**
 * Sync listing performance metrics (views, favorites) from all enabled platforms.
 * Runs daily alongside the analytics sync cron.
 * Platforms that don't support fetchListingMetrics are gracefully skipped.
 */
export async function syncListingMetrics(): Promise<{
  synced: number;
  failed: number;
  perPlatform: Record<string, PlatformSyncResult>;
}> {
  let totalSynced = 0;
  let totalFailed = 0;
  const perPlatform: Record<string, PlatformSyncResult> = {};

  const enabledPlatforms = getEnabledPlatforms();

  for (const platform of enabledPlatforms) {
    const platformResult: PlatformSyncResult = { synced: 0, failed: 0, skipped: false };

    try {
      // Get all published listings for this platform that have an external ID
      const platformListings = await db
        .select()
        .from(listings)
        .where(
          and(
            eq(listings.platform, platform.id),
            eq(listings.status, "published"),
          ),
        )
        .all();

      // Filter to listings that actually have an external listing ID
      const listingsWithExternalId = platformListings.filter(
        (l) => l.externalListingId != null && l.externalListingId !== "",
      );

      if (listingsWithExternalId.length === 0) {
        perPlatform[platform.id] = platformResult;
        continue;
      }

      const externalIds = listingsWithExternalId.map((l) => l.externalListingId!);

      // Fetch metrics from the platform API
      const metricsData = await platform.fetchListingMetrics(externalIds);

      // Build a map of external ID -> metrics for quick lookup
      const metricsMap = new Map(
        metricsData.map((m) => [m.externalListingId, m]),
      );

      for (const listing of listingsWithExternalId) {
        try {
          const platformMetrics = metricsMap.get(listing.externalListingId!);

          // Count sales for this listing from the orders table
          const salesResult = await db
            .select({
              count: sql<number>`count(*)`,
              revenue: sql<number>`coalesce(sum(revenue), 0)`,
            })
            .from(orders)
            .where(eq(orders.listingId, listing.id))
            .get();

          const views = platformMetrics?.views ?? 0;
          const favorites = platformMetrics?.favorites ?? 0;
          const sales = salesResult?.count ?? 0;
          const revenue = salesResult?.revenue ?? 0;
          const conversionRate = views > 0 ? (sales / views) * 100 : 0;

          // Upsert listing metrics
          const existing = await db
            .select()
            .from(listingMetrics)
            .where(eq(listingMetrics.listingId, listing.id))
            .get();

          if (existing) {
            await db
              .update(listingMetrics)
              .set({
                views,
                favorites,
                sales,
                revenue,
                conversionRate: Math.round(conversionRate * 100) / 100,
                syncedAt: new Date().toISOString(),
              })
              .where(eq(listingMetrics.id, existing.id));
          } else {
            await db.insert(listingMetrics).values({
              listingId: listing.id,
              views,
              favorites,
              sales,
              revenue,
              conversionRate: Math.round(conversionRate * 100) / 100,
            });
          }

          platformResult.synced++;
        } catch {
          platformResult.failed++;
        }
      }
    } catch (error) {
      if (error instanceof UnsupportedPlatformOperation) {
        platformResult.skipped = true;
        log("info", `Listing metrics sync skipped for ${platform.id}: operation not supported`);
      } else {
        log("error", `Listing metrics sync failed for ${platform.id}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    perPlatform[platform.id] = platformResult;
    totalSynced += platformResult.synced;
    totalFailed += platformResult.failed;
  }

  log("info", `Listing metrics sync complete: ${totalSynced} synced, ${totalFailed} failed across ${enabledPlatforms.length} platforms`);
  return { synced: totalSynced, failed: totalFailed, perPlatform };
}
