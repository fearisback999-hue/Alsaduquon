import { db } from "@/lib/db";
import { listings, listingMetrics, printifyProducts, designConcepts, niches } from "@/lib/db/schema";
import { eq, and, gt, lt, sql } from "drizzle-orm";
import * as etsy from "@/lib/external/etsy";
import { log } from "@/lib/logger";
import { ETSY_LISTING_FEE, ETSY_TRANSACTION_FEE_PERCENT } from "@/lib/types";

interface RepricingCandidate {
  listingId: string;
  externalListingId: string;
  currentPrice: number;
  baseCost: number;
  views: number;
  sales: number;
  conversionRate: number;
  favorites: number;
  daysSincePublish: number;
  productType: string;
  nicheName: string;
}

interface RepricingResult {
  adjusted: number;
  skipped: number;
  raised: number;
  lowered: number;
}

const MIN_VIEWS_FOR_REPRICING = 50;
const MIN_DAYS_LIVE = 7;
const MIN_MARGIN_PERCENT = 25;

function calculateMinPrice(baseCost: number): number {
  return baseCost / (1 - MIN_MARGIN_PERCENT / 100);
}

function roundToNineNine(price: number): number {
  return Math.floor(price) + 0.99;
}

/**
 * Dynamic repricing engine. Runs daily alongside the optimize cron.
 *
 * Strategy:
 * - High views + high favorites + low conversion → price too high, lower it
 * - High views + high conversion → room to raise price
 * - Low views overall → SEO problem, not price (skip)
 * - Very low conversion after 30+ days → aggressive discount or deactivate
 */
export async function runRepricing(): Promise<RepricingResult> {
  const result: RepricingResult = { adjusted: 0, skipped: 0, raised: 0, lowered: 0 };

  const candidates = await findRepricingCandidates();

  for (const candidate of candidates) {
    const action = determineRepricingAction(candidate);

    if (action.type === "skip") {
      result.skipped++;
      continue;
    }

    const newPrice = roundToNineNine(action.newPrice);
    const minPrice = calculateMinPrice(candidate.baseCost);

    if (newPrice < minPrice) {
      result.skipped++;
      continue;
    }

    if (Math.abs(newPrice - candidate.currentPrice) < 1.0) {
      result.skipped++;
      continue;
    }

    try {
      // Only call Etsy API for Etsy-platform listings
      const listingRecord = await db.select().from(listings).where(eq(listings.id, candidate.listingId)).get();
      if (listingRecord?.platform === "etsy") {
        await etsy.updateListing(parseInt(candidate.externalListingId), {
          price: newPrice,
        });
      }

      await db
        .update(listings)
        .set({
          finalPrice: newPrice,
          updatedAt: new Date().toISOString(),
        })
        .where(eq(listings.id, candidate.listingId));

      log("info", `Repriced "${candidate.nicheName}" ${candidate.productType}: $${candidate.currentPrice} → $${newPrice} (${action.reason})`);

      result.adjusted++;
      if (newPrice > candidate.currentPrice) result.raised++;
      else result.lowered++;
    } catch (error) {
      log("error", `Repricing failed for listing ${candidate.listingId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

async function findRepricingCandidates(): Promise<RepricingCandidate[]> {
  const minDate = new Date(Date.now() - MIN_DAYS_LIVE * 24 * 60 * 60 * 1000).toISOString();

  const rows = await db
    .select({
      listingId: listings.id,
      externalListingId: listings.externalListingId,
      currentPrice: listings.finalPrice,
      baseCost: listings.basePrice,
      publishedAt: listings.publishedAt,
      views: listingMetrics.views,
      sales: listingMetrics.sales,
      conversionRate: listingMetrics.conversionRate,
      favorites: listingMetrics.favorites,
      productType: printifyProducts.productType,
      nicheName: niches.name,
    })
    .from(listings)
    .innerJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
    .innerJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
    .innerJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
    .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
    .where(
      and(
        eq(listings.status, "published"),
        lt(listings.publishedAt, minDate),
        gt(listingMetrics.views, MIN_VIEWS_FOR_REPRICING),
      ),
    )
    .all();

  return rows.map((r) => ({
    listingId: r.listingId,
    externalListingId: r.externalListingId!,
    currentPrice: r.currentPrice,
    baseCost: r.baseCost,
    views: r.views,
    sales: r.sales,
    conversionRate: r.conversionRate ?? 0,
    favorites: r.favorites,
    daysSincePublish: r.publishedAt
      ? Math.floor((Date.now() - new Date(r.publishedAt).getTime()) / (24 * 60 * 60 * 1000))
      : MIN_DAYS_LIVE,
    productType: r.productType,
    nicheName: r.nicheName,
  }));
}

function determineRepricingAction(c: RepricingCandidate): { type: "raise" | "lower" | "skip"; newPrice: number; reason: string } {
  const favoriteRate = c.views > 0 ? (c.favorites / c.views) * 100 : 0;

  // High conversion (>3%) → demand is strong, test a higher price
  if (c.conversionRate > 3.0 && c.sales >= 3) {
    const increase = c.conversionRate > 5.0 ? 0.12 : 0.07;
    return {
      type: "raise",
      newPrice: c.currentPrice * (1 + increase),
      reason: `${c.conversionRate.toFixed(1)}% conversion, testing higher price`,
    };
  }

  // Good favorites but poor conversion → price barrier
  if (favoriteRate > 3.0 && c.conversionRate < 1.0 && c.views > 100) {
    return {
      type: "lower",
      newPrice: c.currentPrice * 0.88,
      reason: `${favoriteRate.toFixed(1)}% favorite rate but ${c.conversionRate.toFixed(1)}% conversion — price barrier`,
    };
  }

  // Decent views, some favorites, low conversion → slight reduction
  if (c.conversionRate < 1.0 && c.views > 150 && c.daysSincePublish > 14) {
    return {
      type: "lower",
      newPrice: c.currentPrice * 0.93,
      reason: `${c.views} views over ${c.daysSincePublish} days, ${c.conversionRate.toFixed(1)}% conversion`,
    };
  }

  // Moderate conversion, test small increase
  if (c.conversionRate >= 2.0 && c.conversionRate <= 3.0 && c.sales >= 2) {
    return {
      type: "raise",
      newPrice: c.currentPrice * 1.04,
      reason: `stable ${c.conversionRate.toFixed(1)}% conversion with ${c.sales} sales`,
    };
  }

  return { type: "skip", newPrice: c.currentPrice, reason: "no action needed" };
}

/**
 * Get profit-per-sale for a given listing.
 * Factors in Printify cost, Etsy listing fee, and Etsy transaction fee.
 */
export function estimateListingProfit(retailPrice: number, baseCost: number): number {
  const etsyFees = ETSY_LISTING_FEE + retailPrice * (ETSY_TRANSACTION_FEE_PERCENT / 100);
  return retailPrice - baseCost - etsyFees;
}
