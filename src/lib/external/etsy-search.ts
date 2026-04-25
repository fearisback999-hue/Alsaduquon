import { rateLimit } from "./rate-limiter";
import { withRetry } from "@/lib/retry";
import { log } from "@/lib/logger";

const BASE_URL = "https://openapi.etsy.com/v3";

interface EtsySearchResult {
  keyword: string;
  activeListingCount: number;
  avgPrice: number;
  avgFavorites: number;
  topListingSales: number;
  demandSignal: "strong" | "moderate" | "weak" | "none";
  competitionLevel: "saturated" | "competitive" | "moderate" | "low";
  viabilityScore: number; // 0-100
}

interface EtsyListingHit {
  listing_id: number;
  title: string;
  price: { amount: number; divisor: number };
  num_favorers: number;
  views: number;
  quantity: number;
}

/**
 * Validates a niche keyword against real Etsy marketplace data.
 * Uses the public listings search endpoint to get:
 * - Total active listing count (competition)
 * - Price distribution (market positioning)
 * - Favorites/views (demand signal)
 *
 * This replaces the AI-guessed competition scores with real data.
 */
export async function validateNicheOnEtsy(keyword: string): Promise<EtsySearchResult> {
  await rateLimit("etsy");
  const apiKey = process.env.ETSY_CLIENT_ID;
  if (!apiKey) {
    return defaultResult(keyword);
  }

  try {
    const params = new URLSearchParams({
      keywords: keyword,
      limit: "25",
      sort_on: "score",
    });

    const data = await withRetry(async () => {
      const res = await fetch(`${BASE_URL}/application/listings/active?${params.toString()}`, {
        headers: { "x-api-key": apiKey },
      });
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Etsy search failed (${res.status}): ${body}`);
      }
      return res.json();
    }, { maxAttempts: 2, baseDelayMs: 1000 });

    const count = (data as { count?: number }).count ?? 0;
    const results = ((data as { results?: EtsyListingHit[] }).results ?? []) as EtsyListingHit[];

    if (results.length === 0) {
      return { ...defaultResult(keyword), activeListingCount: count, demandSignal: "none", competitionLevel: "low", viabilityScore: 15 };
    }

    const prices = results.map((r) => r.price.amount / r.price.divisor);
    const favorites = results.map((r) => r.num_favorers ?? 0);
    const avgPrice = prices.reduce((a, b) => a + b, 0) / prices.length;
    const avgFavorites = favorites.reduce((a, b) => a + b, 0) / favorites.length;
    const topListingSales = Math.max(...favorites); // favorites as proxy for sales momentum

    const demandSignal = classifyDemand(avgFavorites, count);
    const competitionLevel = classifyCompetition(count);
    const viabilityScore = calculateViability(count, avgFavorites, avgPrice, topListingSales);

    return {
      keyword,
      activeListingCount: count,
      avgPrice: Math.round(avgPrice * 100) / 100,
      avgFavorites: Math.round(avgFavorites),
      topListingSales,
      demandSignal,
      competitionLevel,
      viabilityScore,
    };
  } catch (error) {
    log("warn", `[Etsy Search] Validation failed for "${keyword}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return defaultResult(keyword);
  }
}

/**
 * Batch-validate multiple niche keywords. Rate-limits to stay within
 * Etsy's 10 req/sec budget while validating up to ~50 keywords per run.
 */
export async function batchValidateNiches(
  keywords: string[],
): Promise<Map<string, EtsySearchResult>> {
  const results = new Map<string, EtsySearchResult>();

  for (const keyword of keywords) {
    const result = await validateNicheOnEtsy(keyword);
    results.set(keyword, result);
  }

  return results;
}

function classifyDemand(avgFavorites: number, listingCount: number): EtsySearchResult["demandSignal"] {
  if (avgFavorites >= 100) return "strong";
  if (avgFavorites >= 30 || listingCount >= 5000) return "moderate";
  if (avgFavorites >= 5) return "weak";
  return "none";
}

function classifyCompetition(listingCount: number): EtsySearchResult["competitionLevel"] {
  if (listingCount >= 50000) return "saturated";
  if (listingCount >= 10000) return "competitive";
  if (listingCount >= 1000) return "moderate";
  return "low";
}

/**
 * Sweet spot: moderate demand (people want it) + low-moderate competition
 * (not too many sellers). Saturated high-demand niches score low because
 * you'll never rank. Zero-demand niches score low because nobody's buying.
 */
function calculateViability(
  listingCount: number,
  avgFavorites: number,
  avgPrice: number,
  topFavorites: number,
): number {
  let score = 0;

  // Demand signal (40 points max)
  if (avgFavorites >= 100) score += 40;
  else if (avgFavorites >= 50) score += 35;
  else if (avgFavorites >= 20) score += 28;
  else if (avgFavorites >= 5) score += 15;
  else score += 3;

  // Competition sweet spot (30 points max)
  // Best: 1,000-10,000 listings (enough demand, not oversaturated)
  if (listingCount >= 1000 && listingCount <= 10000) score += 30;
  else if (listingCount >= 500 && listingCount <= 20000) score += 22;
  else if (listingCount >= 100 && listingCount <= 50000) score += 12;
  else if (listingCount < 100) score += 8; // too niche, may have no demand
  else score += 5; // saturated

  // Price viability (15 points max) — POD margins need $20+ prices
  if (avgPrice >= 25 && avgPrice <= 45) score += 15;
  else if (avgPrice >= 18) score += 10;
  else score += 3;

  // Top performer signal (15 points max) — a listing with lots of
  // favorites proves buyers exist in this niche
  if (topFavorites >= 500) score += 15;
  else if (topFavorites >= 100) score += 12;
  else if (topFavorites >= 30) score += 8;
  else score += 2;

  return Math.min(100, Math.max(0, score));
}

function defaultResult(keyword: string): EtsySearchResult {
  return {
    keyword,
    activeListingCount: 0,
    avgPrice: 0,
    avgFavorites: 0,
    topListingSales: 0,
    demandSignal: "none",
    competitionLevel: "low",
    viabilityScore: 0,
  };
}
