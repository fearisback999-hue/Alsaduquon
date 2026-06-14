import { db } from "@/lib/db";
import { listings, printifyProducts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { estimateEtsyFees, getLandedCost, getTypicalCost, getTargetMargin } from "@/lib/pricing/engine";
import { isShippingIncludedInCost } from "@/lib/pricing/shipping";

// Flag a listing when its margin, recomputed against CURRENT cost estimates,
// has fallen more than this many points below the product's target — the early
// warning that a Printify price change (or a stale/mispriced listing) is
// quietly eroding profit at scale.
const DRIFT_THRESHOLD_PCTPTS = 5;
// Always flag anything below this absolute net margin, regardless of target.
const HARD_FLOOR_MARGIN = 15;

const round1 = (n: number) => Math.round(n * 10) / 10;

export interface MarginDriftItem {
  listingId: string;
  title: string;
  productType: string;
  finalPrice: number;
  currentLandedCost: number;
  currentMarginPct: number;
  targetMarginPct: number;
  shortfallPctPts: number;
}

export interface MarginDriftResult {
  checked: number;
  drifted: MarginDriftItem[];
  worstMarginPct: number | null;
}

/**
 * Recomputes every published listing's net margin using today's cost estimates
 * (base cost + shipping under the active model) and the real Etsy fee stack,
 * then flags any whose margin has drifted below target or under the hard floor.
 *
 * Read-only — it never edits prices. Surfacing the drift is the point; what to
 * do about it (reprice, deactivate) stays a human/operator decision.
 */
export async function detectMarginDrift(): Promise<MarginDriftResult> {
  const includeShipping = await isShippingIncludedInCost();

  const rows = await db
    .select({
      id: listings.id,
      title: listings.title,
      finalPrice: listings.finalPrice,
      productType: printifyProducts.productType,
    })
    .from(listings)
    .innerJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
    .where(eq(listings.status, "published"))
    .all();

  const drifted: MarginDriftItem[] = [];
  let worst: number | null = null;

  for (const r of rows) {
    if (!r.finalPrice || r.finalPrice <= 0) continue;
    const landed = getLandedCost(r.productType, getTypicalCost(r.productType), includeShipping);
    const fees = estimateEtsyFees(r.finalPrice);
    const margin = ((r.finalPrice - landed - fees) / r.finalPrice) * 100;
    const target = getTargetMargin(r.productType);
    const shortfall = target - margin;

    worst = worst === null ? margin : Math.min(worst, margin);

    if (margin < HARD_FLOOR_MARGIN || shortfall > DRIFT_THRESHOLD_PCTPTS) {
      drifted.push({
        listingId: r.id,
        title: r.title,
        productType: r.productType,
        finalPrice: r.finalPrice,
        currentLandedCost: round1(landed),
        currentMarginPct: round1(margin),
        targetMarginPct: target,
        shortfallPctPts: round1(shortfall),
      });
    }
  }

  // Worst offenders first so a truncated alert shows the most urgent ones.
  drifted.sort((a, b) => a.currentMarginPct - b.currentMarginPct);

  return { checked: rows.length, drifted, worstMarginPct: worst === null ? null : round1(worst) };
}
