import { db } from "@/lib/db";
import { niches, designConcepts, printifyProducts, etsyListings, orders, listingMetrics } from "@/lib/db/schema";
import { eq, and, sql, gte, desc } from "drizzle-orm";
import { log } from "@/lib/logger";

interface WinningDesign {
  conceptId: string;
  conceptTitle: string;
  designType: string;
  styleCategory: string;
  nicheId: string;
  nicheName: string;
  totalOrders: number;
  totalRevenue: number;
  conversionRate: number;
  variantCount: number;
}

interface AmplificationCandidate {
  nicheId: string;
  nicheName: string;
  winningDesign: WinningDesign;
  recommendedConceptCount: number;
}

const MIN_ORDERS_FOR_WINNER = 3;
const MIN_CONVERSION_FOR_WINNER = 2.0;
const MAX_VARIANTS_PER_WINNER = 5;
const LOOKBACK_DAYS = 60;

/**
 * Identifies designs that are selling well and recommends generating
 * style variants in the same niche. The "fast follower" pattern —
 * winners tell us what works, we make more in the same vein.
 */
export async function findAmplificationCandidates(): Promise<AmplificationCandidate[]> {
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();

  try {
    const winners = await db
      .select({
        conceptId: designConcepts.id,
        conceptTitle: designConcepts.title,
        designType: designConcepts.designType,
        colorPalette: designConcepts.colorPalette,
        nicheId: niches.id,
        nicheName: niches.name,
        totalOrders: sql<number>`count(distinct ${orders.id})`,
        totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
        conversionRate: sql<number>`coalesce(max(${listingMetrics.conversionRate}), 0)`,
      })
      .from(designConcepts)
      .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
      .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(etsyListings, eq(etsyListings.printifyProductId, printifyProducts.id))
      .innerJoin(orders, eq(orders.etsyListingId, etsyListings.id))
      .leftJoin(listingMetrics, eq(listingMetrics.etsyListingId, etsyListings.id))
      .where(gte(orders.orderedAt, cutoff))
      .groupBy(designConcepts.id)
      .having(sql`count(distinct ${orders.id}) >= ${MIN_ORDERS_FOR_WINNER}`)
      .orderBy(desc(sql`sum(${orders.revenue})`))
      .all();

    const candidates: AmplificationCandidate[] = [];

    for (const winner of winners) {
      let styleCategory = "unknown";
      try {
        const palette = JSON.parse(winner.colorPalette ?? "{}");
        styleCategory = palette.style_category ?? "unknown";
      } catch { /* ignore */ }

      // Count existing variants in this niche to avoid over-amplifying
      const variantCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(designConcepts)
        .where(eq(designConcepts.nicheId, winner.nicheId))
        .get();

      const existingVariants = variantCount?.count ?? 0;
      const remainingCapacity = MAX_VARIANTS_PER_WINNER - Math.floor(existingVariants / 5);

      if (remainingCapacity <= 0) continue;
      if (winner.conversionRate > 0 && winner.conversionRate < MIN_CONVERSION_FOR_WINNER) continue;

      candidates.push({
        nicheId: winner.nicheId,
        nicheName: winner.nicheName,
        winningDesign: {
          conceptId: winner.conceptId,
          conceptTitle: winner.conceptTitle,
          designType: winner.designType ?? "hybrid",
          styleCategory,
          nicheId: winner.nicheId,
          nicheName: winner.nicheName,
          totalOrders: winner.totalOrders,
          totalRevenue: winner.totalRevenue,
          conversionRate: winner.conversionRate,
          variantCount: existingVariants,
        },
        recommendedConceptCount: Math.min(remainingCapacity, 3),
      });
    }

    return candidates;
  } catch (error) {
    log("error", "Failed to find amplification candidates", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Re-activates winning niches so the next pipeline run generates more
 * concepts in them. Sets niche.status = "approved" so step-03 picks them up.
 */
export async function amplifyWinningNiches(): Promise<{ amplified: number }> {
  const candidates = await findAmplificationCandidates();
  let amplified = 0;

  for (const candidate of candidates) {
    try {
      await db
        .update(niches)
        .set({
          status: "approved",
          updatedAt: new Date().toISOString(),
        })
        .where(eq(niches.id, candidate.nicheId));

      log("info", `Amplifying winning niche: "${candidate.nicheName}" — ${candidate.winningDesign.totalOrders} orders, $${candidate.winningDesign.totalRevenue.toFixed(0)} revenue (${candidate.winningDesign.designType}/${candidate.winningDesign.styleCategory})`);
      amplified++;
    } catch (error) {
      log("error", `Failed to amplify niche ${candidate.nicheName}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { amplified };
}
