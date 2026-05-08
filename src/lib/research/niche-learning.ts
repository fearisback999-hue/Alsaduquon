import { db } from "@/lib/db";
import { niches, nicheLearningWeights, orders, listings, designConcepts } from "@/lib/db/schema";
import { eq, sql, inArray } from "drizzle-orm";
import { SCORING_WEIGHTS } from "@/lib/types";
import { log } from "@/lib/logger";

interface MetricOutcomePair {
  metric: number;
  outcome: number;
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  search_volume: SCORING_WEIGHTS.searchVolume,
  competition: SCORING_WEIGHTS.competition,
  sales_velocity: SCORING_WEIGHTS.salesVelocity,
  seasonality: SCORING_WEIGHTS.seasonality,
  trending: SCORING_WEIGHTS.trending,
  velocity: 0,
  triangulation: 0,
};

const MIN_SAMPLE_SIZE = 15;

function pearsonCorrelation(pairs: MetricOutcomePair[]): number {
  const n = pairs.length;
  if (n < 3) return 0;

  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (const { metric: x, outcome: y } of pairs) {
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }

  const numerator = n * sumXY - sumX * sumY;
  const denominator = Math.sqrt((n * sumX2 - sumX * sumX) * (n * sumY2 - sumY * sumY));
  if (denominator === 0) return 0;

  return numerator / denominator;
}

/**
 * Trains scoring weights by correlating each niche metric with actual
 * order performance. Niches with orders are "positive" outcomes; niches
 * with zero orders are "negative" outcomes. The correlation tells us
 * which metrics actually predict sales, so we can shift weight toward them.
 */
export async function trainScoringWeights(): Promise<{
  trained: boolean;
  sampleSize: number;
  weights: Record<string, number>;
}> {
  // Get all niches that have been scored and have at least one listing published
  const scoredNiches = await db
    .select({
      id: niches.id,
      compositeScore: niches.compositeScore,
      searchVolume: niches.searchVolume,
      competitionLevel: niches.competitionLevel,
      salesVelocity: niches.salesVelocity,
      seasonalityScore: niches.seasonalityScore,
      trendingScore: niches.trendingScore,
      velocityScore: niches.velocityScore,
      triangulationScore: niches.triangulationScore,
    })
    .from(niches)
    .where(inArray(niches.status, ["active", "approved", "exhausted", "saturated"]))
    .all();

  if (scoredNiches.length < MIN_SAMPLE_SIZE) {
    return { trained: false, sampleSize: scoredNiches.length, weights: DEFAULT_WEIGHTS };
  }

  // For each niche, count total orders (through designConcepts -> listings -> orders)
  const nicheOutcomes = new Map<string, number>();
  for (const niche of scoredNiches) {
    const result = await db
      .select({ orderCount: sql<number>`count(${orders.id})` })
      .from(orders)
      .innerJoin(listings, eq(orders.listingId, listings.id))
      .innerJoin(
        sql`printify_products`,
        sql`${listings.printifyProductId} = printify_products.id`,
      )
      .innerJoin(designConcepts, sql`printify_products.design_concept_id = ${designConcepts.id}`)
      .where(eq(designConcepts.nicheId, niche.id))
      .get();

    nicheOutcomes.set(niche.id, result?.orderCount ?? 0);
  }

  // Build metric-outcome pairs for each scoring dimension
  const metricPairs: Record<string, MetricOutcomePair[]> = {
    search_volume: [],
    competition: [],
    sales_velocity: [],
    seasonality: [],
    trending: [],
    velocity: [],
    triangulation: [],
  };

  for (const niche of scoredNiches) {
    const outcome = nicheOutcomes.get(niche.id) ?? 0;

    if (niche.searchVolume != null) {
      const normalized = Math.min(10, Math.log10(Math.max(1, niche.searchVolume)) * 2);
      metricPairs.search_volume.push({ metric: normalized, outcome });
    }
    if (niche.competitionLevel != null) {
      metricPairs.competition.push({ metric: (1 - niche.competitionLevel) * 10, outcome });
    }
    if (niche.salesVelocity != null) {
      metricPairs.sales_velocity.push({ metric: niche.salesVelocity, outcome });
    }
    if (niche.seasonalityScore != null) {
      metricPairs.seasonality.push({ metric: niche.seasonalityScore, outcome });
    }
    if (niche.trendingScore != null) {
      metricPairs.trending.push({ metric: niche.trendingScore, outcome });
    }
    if (niche.velocityScore != null) {
      metricPairs.velocity.push({ metric: niche.velocityScore, outcome });
    }
    if (niche.triangulationScore != null) {
      metricPairs.triangulation.push({ metric: niche.triangulationScore / 10, outcome });
    }
  }

  // Compute correlations and derive new weights
  const correlations: Record<string, number> = {};
  const rawWeights: Record<string, number> = {};
  let totalPositiveCorrelation = 0;

  for (const [metric, pairs] of Object.entries(metricPairs)) {
    if (pairs.length < MIN_SAMPLE_SIZE) {
      correlations[metric] = 0;
      rawWeights[metric] = DEFAULT_WEIGHTS[metric] ?? 0;
      continue;
    }

    const r = pearsonCorrelation(pairs);
    correlations[metric] = Math.round(r * 1000) / 1000;

    // Only positive correlations contribute weight — negative means
    // the metric actually hurts predictions, so we zero it out.
    const positiveR = Math.max(0, r);
    rawWeights[metric] = positiveR;
    totalPositiveCorrelation += positiveR;
  }

  // Normalize weights to sum to 1.0
  // Blend 50% learned weights with 50% defaults to avoid wild swings
  const learnedWeights: Record<string, number> = {};
  const BLEND_RATIO = 0.5;

  for (const metric of Object.keys(DEFAULT_WEIGHTS)) {
    const defaultW = DEFAULT_WEIGHTS[metric] ?? 0;
    let learnedW = 0;
    if (totalPositiveCorrelation > 0) {
      learnedW = (rawWeights[metric] ?? 0) / totalPositiveCorrelation;
    }
    learnedWeights[metric] = Math.round((defaultW * (1 - BLEND_RATIO) + learnedW * BLEND_RATIO) * 1000) / 1000;
  }

  // Ensure they sum to 1.0
  const weightSum = Object.values(learnedWeights).reduce((a, b) => a + b, 0);
  if (weightSum > 0) {
    for (const key of Object.keys(learnedWeights)) {
      learnedWeights[key] = Math.round((learnedWeights[key] / weightSum) * 1000) / 1000;
    }
  }

  // Persist to nicheLearningWeights table
  const now = new Date().toISOString();
  for (const [metric, weight] of Object.entries(learnedWeights)) {
    const existing = await db
      .select()
      .from(nicheLearningWeights)
      .where(eq(nicheLearningWeights.metric, metric))
      .get();

    const data = {
      weight,
      correlation: correlations[metric] ?? null,
      sampleSize: metricPairs[metric]?.length ?? 0,
      lastTrainedAt: now,
    };

    if (existing) {
      await db.update(nicheLearningWeights).set(data).where(eq(nicheLearningWeights.id, existing.id));
    } else {
      await db.insert(nicheLearningWeights).values({ metric, ...data });
    }
  }

  log("info", `[niche-learning] Trained weights from ${scoredNiches.length} niches: ${JSON.stringify(learnedWeights)}`);
  log("info", `[niche-learning] Correlations: ${JSON.stringify(correlations)}`);

  return { trained: true, sampleSize: scoredNiches.length, weights: learnedWeights };
}

/**
 * Returns the current effective scoring weights. Falls back to defaults
 * if no learned weights exist or if sample size is too small.
 */
export async function getEffectiveWeights(): Promise<{
  searchVolume: number;
  competition: number;
  salesVelocity: number;
  seasonality: number;
  trending: number;
  velocity: number;
  triangulation: number;
  source: "learned" | "default";
}> {
  const rows = await db.select().from(nicheLearningWeights).all();

  if (rows.length === 0 || rows.some((r) => r.sampleSize < MIN_SAMPLE_SIZE)) {
    return {
      searchVolume: SCORING_WEIGHTS.searchVolume,
      competition: SCORING_WEIGHTS.competition,
      salesVelocity: SCORING_WEIGHTS.salesVelocity,
      seasonality: SCORING_WEIGHTS.seasonality,
      trending: SCORING_WEIGHTS.trending,
      velocity: 0,
      triangulation: 0,
      source: "default",
    };
  }

  const weightMap = new Map(rows.map((r) => [r.metric, r.weight]));

  return {
    searchVolume: weightMap.get("search_volume") ?? SCORING_WEIGHTS.searchVolume,
    competition: weightMap.get("competition") ?? SCORING_WEIGHTS.competition,
    salesVelocity: weightMap.get("sales_velocity") ?? SCORING_WEIGHTS.salesVelocity,
    seasonality: weightMap.get("seasonality") ?? SCORING_WEIGHTS.seasonality,
    trending: weightMap.get("trending") ?? SCORING_WEIGHTS.trending,
    velocity: weightMap.get("velocity") ?? 0,
    triangulation: weightMap.get("triangulation") ?? 0,
    source: "learned",
  };
}
