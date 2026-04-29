import { db } from "@/lib/db";
import { niches, designConcepts, printifyProducts, listings, orders, listingMetrics } from "@/lib/db/schema";
import { eq, and, sql, lt, inArray } from "drizzle-orm";
import { log } from "@/lib/logger";

interface PruningResult {
  exhausted: number;
  candidates: Array<{ nicheId: string; nicheName: string; reason: string }>;
}

const MIN_LISTINGS_FOR_VERDICT = 3;
const MIN_DAYS_FOR_VERDICT = 45;
const MAX_VIEWS_TO_PRUNE = 50;
const MAX_FAVORITES_TO_PRUNE = 5;

/**
 * Marks dead niches as "exhausted" so they don't get re-scored or
 * re-generated. A niche is dead if it has had 3+ listings for 45+ days
 * with effectively zero engagement (low views, low favorites, zero sales).
 *
 * This frees up the scoring/concept generation budget to focus on niches
 * that have a chance of selling, instead of grinding the same losers.
 */
export async function pruneDeadNiches(): Promise<PruningResult> {
  const cutoff = new Date(Date.now() - MIN_DAYS_FOR_VERDICT * 24 * 60 * 60 * 1000).toISOString();

  try {
    const candidates = await db
      .select({
        nicheId: niches.id,
        nicheName: niches.name,
        listingCount: sql<number>`count(distinct ${listings.id})`,
        totalViews: sql<number>`coalesce(sum(${listingMetrics.views}), 0)`,
        totalFavorites: sql<number>`coalesce(sum(${listingMetrics.favorites}), 0)`,
        totalOrders: sql<number>`count(distinct ${orders.id})`,
        oldestListingAt: sql<string>`min(${listings.publishedAt})`,
      })
      .from(niches)
      .innerJoin(designConcepts, eq(designConcepts.nicheId, niches.id))
      .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
      .leftJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
      .leftJoin(orders, eq(orders.listingId, listings.id))
      .where(
        and(
          eq(listings.status, "published"),
          inArray(niches.status, ["active", "approved"]),
        ),
      )
      .groupBy(niches.id)
      .having(
        sql`count(distinct ${listings.id}) >= ${MIN_LISTINGS_FOR_VERDICT} AND min(${listings.publishedAt}) < ${cutoff} AND count(distinct ${orders.id}) = 0 AND coalesce(sum(${listingMetrics.views}), 0) < ${MAX_VIEWS_TO_PRUNE} AND coalesce(sum(${listingMetrics.favorites}), 0) < ${MAX_FAVORITES_TO_PRUNE}`,
      )
      .all();

    const result: PruningResult = { exhausted: 0, candidates: [] };

    for (const candidate of candidates) {
      const reason = `${candidate.listingCount} listings over ${MIN_DAYS_FOR_VERDICT}+ days, ${candidate.totalViews} views, ${candidate.totalFavorites} favorites, 0 sales`;

      try {
        await db
          .update(niches)
          .set({
            status: "exhausted",
            updatedAt: new Date().toISOString(),
          })
          .where(eq(niches.id, candidate.nicheId));

        log("info", `Pruned dead niche: "${candidate.nicheName}" — ${reason}`);
        result.candidates.push({ nicheId: candidate.nicheId, nicheName: candidate.nicheName, reason });
        result.exhausted++;
      } catch (error) {
        log("error", `Failed to prune niche ${candidate.nicheName}`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return result;
  } catch (error) {
    log("error", "Niche pruning failed", { error: error instanceof Error ? error.message : String(error) });
    return { exhausted: 0, candidates: [] };
  }
}
