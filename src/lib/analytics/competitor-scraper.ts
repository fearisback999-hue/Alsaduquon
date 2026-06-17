import { db } from "@/lib/db";
import { niches, competitorPricing, listings } from "@/lib/db/schema";
import { eq, or, sql, desc, inArray } from "drizzle-orm";
import { rateLimit } from "@/lib/external/rate-limiter";
import { withRetry } from "@/lib/retry";
import { log } from "@/lib/logger";

const ETSY_BASE_URL = "https://openapi.etsy.com/v3";
const MAX_NICHES_PER_RUN = 10;
const LISTINGS_PER_NICHE = 25;
const SCRAPE_COOLDOWN_DAYS = 7;

interface EtsyListingHit {
  listing_id: number;
  title: string;
  price: { amount: number; divisor: number };
  num_favorers: number;
  views: number;
  quantity: number;
  shop?: { shop_name?: string };
}

interface CompetitorScrapeResult {
  nichesScraped: number;
  listingsScraped: number;
  avgPrice: number;
}

/**
 * Scrapes competitor pricing from Etsy for active/approved niches.
 * Skips niches already scraped within the last 7 days.
 * Inserts top listing data into the competitorPricing table.
 */
export async function scrapeCompetitorPricing(): Promise<CompetitorScrapeResult> {
  const apiKey = process.env.ETSY_CLIENT_ID;
  if (!apiKey) {
    log("warn", "[CompetitorScraper] ETSY_CLIENT_ID not set, skipping");
    return { nichesScraped: 0, listingsScraped: 0, avgPrice: 0 };
  }

  // Find active/approved niches
  const activeNiches = await db
    .select({ id: niches.id, name: niches.name })
    .from(niches)
    .where(or(eq(niches.status, "active"), eq(niches.status, "approved")))
    .limit(MAX_NICHES_PER_RUN * 2) // Fetch extra since some may be recently scraped
    .all();

  if (activeNiches.length === 0) {
    log("info", "[CompetitorScraper] No active/approved niches to scrape");
    return { nichesScraped: 0, listingsScraped: 0, avgPrice: 0 };
  }

  // Check which niches were scraped recently (within last 7 days)
  const cooldownDate = new Date(Date.now() - SCRAPE_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const nicheIds = activeNiches.map((n) => n.id);

  const recentlyScrapped = await db
    .select({
      nicheId: competitorPricing.nicheId,
      latestScrape: sql<string>`max(${competitorPricing.scrapedAt})`,
    })
    .from(competitorPricing)
    .where(inArray(competitorPricing.nicheId, nicheIds))
    .groupBy(competitorPricing.nicheId)
    .all();

  const recentNicheIds = new Set(
    recentlyScrapped
      .filter((r) => r.latestScrape && r.latestScrape > cooldownDate)
      .map((r) => r.nicheId),
  );

  // Filter to niches not recently scraped, limit to MAX_NICHES_PER_RUN
  const nichesToScrape = activeNiches
    .filter((n) => !recentNicheIds.has(n.id))
    .slice(0, MAX_NICHES_PER_RUN);

  if (nichesToScrape.length === 0) {
    log("info", "[CompetitorScraper] All active niches were scraped within the last 7 days");
    return { nichesScraped: 0, listingsScraped: 0, avgPrice: 0 };
  }

  let totalListingsScraped = 0;
  let totalPriceSum = 0;
  let totalPriceCount = 0;

  for (const niche of nichesToScrape) {
    try {
      const scraped = await scrapeNicheListings(niche.id, niche.name, apiKey);
      totalListingsScraped += scraped.count;
      totalPriceSum += scraped.priceSum;
      totalPriceCount += scraped.count;

      log("info", `[CompetitorScraper] Scraped ${scraped.count} listings for "${niche.name}" (avg $${scraped.count > 0 ? (scraped.priceSum / scraped.count).toFixed(2) : "0"})`);
    } catch (error) {
      log("warn", `[CompetitorScraper] Failed to scrape niche "${niche.name}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const avgPrice = totalPriceCount > 0
    ? Math.round((totalPriceSum / totalPriceCount) * 100) / 100
    : 0;

  log("info", `[CompetitorScraper] Complete: ${nichesToScrape.length} niches, ${totalListingsScraped} listings, avg price $${avgPrice}`);

  return {
    nichesScraped: nichesToScrape.length,
    listingsScraped: totalListingsScraped,
    avgPrice,
  };
}

/**
 * Scrapes Etsy search results for a single niche keyword and inserts
 * competitor listing data into the database.
 */
async function scrapeNicheListings(
  nicheId: string,
  keyword: string,
  apiKey: string,
): Promise<{ count: number; priceSum: number }> {
  await rateLimit("etsy");

  const params = new URLSearchParams({
    keywords: keyword,
    limit: String(LISTINGS_PER_NICHE),
    sort_on: "score",
    includes: "Shops",
  });

  const data = await withRetry(async () => {
    const res = await fetch(
      `${ETSY_BASE_URL}/application/listings/active?${params.toString()}`,
      { headers: { "x-api-key": apiKey } },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Etsy search failed (${res.status}): ${body}`);
    }
    return res.json();
  }, { maxAttempts: 2, baseDelayMs: 1000 });

  const results = ((data as { results?: EtsyListingHit[] }).results ?? []) as EtsyListingHit[];

  if (results.length === 0) {
    return { count: 0, priceSum: 0 };
  }

  const now = new Date().toISOString();
  let priceSum = 0;

  // Batch insert all scraped listings
  const rows = results.map((listing) => {
    const price = listing.price.amount / listing.price.divisor;
    priceSum += price;

    return {
      nicheId,
      platform: "etsy" as const,
      externalListingId: String(listing.listing_id),
      title: listing.title?.slice(0, 500) ?? null,
      price,
      currency: "USD",
      favorites: listing.num_favorers ?? 0,
      sales: listing.views ?? 0, // views as best available proxy
      sellerName: listing.shop?.shop_name ?? null,
      scrapedAt: now,
    };
  });

  // Insert in a single batch for efficiency
  await db.insert(competitorPricing).values(rows);

  return { count: results.length, priceSum };
}

/**
 * Returns competitor pricing analysis grouped by niche, including
 * comparison with our own pricing.
 */
export async function getCompetitorAnalysis(): Promise<Array<{
  nicheId: string;
  nicheName: string;
  avgCompetitorPrice: number;
  minCompetitorPrice: number;
  maxCompetitorPrice: number;
  avgFavorites: number;
  listingCount: number;
  ourAvgPrice: number;
  pricePosition: "below" | "at" | "above";
  lastScrapedAt: string | null;
}>> {
  // Get competitor stats grouped by niche
  const competitorStats = await db
    .select({
      nicheId: competitorPricing.nicheId,
      nicheName: niches.name,
      avgPrice: sql<number>`avg(${competitorPricing.price})`,
      minPrice: sql<number>`min(${competitorPricing.price})`,
      maxPrice: sql<number>`max(${competitorPricing.price})`,
      avgFavorites: sql<number>`avg(${competitorPricing.favorites})`,
      listingCount: sql<number>`count(*)`,
      lastScrapedAt: sql<string>`max(${competitorPricing.scrapedAt})`,
    })
    .from(competitorPricing)
    .innerJoin(niches, eq(competitorPricing.nicheId, niches.id))
    .groupBy(competitorPricing.nicheId)
    .orderBy(desc(sql`count(*)`))
    .all();

  if (competitorStats.length === 0) {
    return [];
  }

  // Get our average prices per niche (through designConcepts -> printifyProducts -> listings)
  const ourPrices = await db
    .select({
      nicheId: niches.id,
      avgPrice: sql<number>`avg(${listings.finalPrice})`,
    })
    .from(listings)
    .innerJoin(
      sql`printify_products`,
      sql`${listings.printifyProductId} = printify_products.id`,
    )
    .innerJoin(
      sql`design_concepts`,
      sql`printify_products.design_concept_id = design_concepts.id`,
    )
    .innerJoin(niches, sql`design_concepts.niche_id = ${niches.id}`)
    .where(eq(listings.status, "published"))
    .groupBy(niches.id)
    .all();

  const ourPriceMap = new Map(ourPrices.map((p) => [p.nicheId, p.avgPrice]));

  return competitorStats.map((stat) => {
    const avgComp = Math.round((stat.avgPrice ?? 0) * 100) / 100;
    const ourAvg = Math.round((ourPriceMap.get(stat.nicheId) ?? 0) * 100) / 100;

    // Determine price position: within 10% is "at market"
    let pricePosition: "below" | "at" | "above";
    if (ourAvg === 0) {
      pricePosition = "below"; // No listings yet
    } else if (ourAvg < avgComp * 0.9) {
      pricePosition = "below";
    } else if (ourAvg > avgComp * 1.1) {
      pricePosition = "above";
    } else {
      pricePosition = "at";
    }

    return {
      nicheId: stat.nicheId,
      nicheName: stat.nicheName,
      avgCompetitorPrice: avgComp,
      minCompetitorPrice: Math.round((stat.minPrice ?? 0) * 100) / 100,
      maxCompetitorPrice: Math.round((stat.maxPrice ?? 0) * 100) / 100,
      avgFavorites: Math.round(stat.avgFavorites ?? 0),
      listingCount: stat.listingCount,
      ourAvgPrice: ourAvg,
      pricePosition,
      lastScrapedAt: stat.lastScrapedAt ?? null,
    };
  });
}
