import { db } from "@/lib/db";
import { etsyListings, listingMetrics, orders } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import * as etsy from "@/lib/external/etsy";
import { log } from "@/lib/logger";

/**
 * Sync listing performance metrics (views, favorites) from Etsy API.
 * Runs daily alongside the analytics sync cron.
 */
export async function syncListingMetrics(): Promise<{ synced: number; failed: number }> {
  let synced = 0;
  let failed = 0;

  try {
    // Fetch active listings from Etsy (paginated)
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await etsy.getShopListings("active", limit, offset);
      const etsyResults = response.results ?? [];

      for (const etsyListing of etsyResults) {
        try {
          // Find our internal listing record by Etsy listing ID
          const internalListing = await db
            .select()
            .from(etsyListings)
            .where(eq(etsyListings.etsyListingId, String(etsyListing.listing_id)))
            .get();

          if (!internalListing) continue;

          // Count sales for this listing
          const salesResult = await db
            .select({ count: sql<number>`count(*)`, revenue: sql<number>`coalesce(sum(revenue), 0)` })
            .from(orders)
            .where(eq(orders.etsyListingId, internalListing.id))
            .get();

          const views = etsyListing.views ?? 0;
          const favorites = etsyListing.num_favorers ?? 0;
          const sales = salesResult?.count ?? 0;
          const revenue = salesResult?.revenue ?? 0;
          const conversionRate = views > 0 ? (sales / views) * 100 : 0;

          // Upsert listing metrics
          const existing = await db
            .select()
            .from(listingMetrics)
            .where(eq(listingMetrics.etsyListingId, internalListing.id))
            .get();

          if (existing) {
            await db.update(listingMetrics).set({
              views,
              favorites,
              sales,
              revenue,
              conversionRate: Math.round(conversionRate * 100) / 100,
              syncedAt: new Date().toISOString(),
            }).where(eq(listingMetrics.id, existing.id));
          } else {
            await db.insert(listingMetrics).values({
              etsyListingId: internalListing.id,
              views,
              favorites,
              sales,
              revenue,
              conversionRate: Math.round(conversionRate * 100) / 100,
            });
          }

          synced++;
        } catch {
          failed++;
        }
      }

      offset += limit;
      hasMore = etsyResults.length === limit;
    }
  } catch (error) {
    log("error", "Listing metrics sync failed", { error: error instanceof Error ? error.message : String(error) });
  }

  log("info", `Listing metrics sync: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}
