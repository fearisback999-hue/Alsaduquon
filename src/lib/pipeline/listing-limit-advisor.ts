import { db } from "@/lib/db";
import { listings, orders, settings } from "@/lib/db/schema";
import { eq, asc } from "drizzle-orm";

/**
 * Ban-safe daily-listing ceilings by shop age. Etsy throttles brand-new shops
 * and flags accounts that publish in volume before they've built standing;
 * these tiers mirror conservative, community-tested ramps. They ASSUME good
 * standing (no policy strikes, healthy order/cancellation rates).
 *
 * This is advisory only — the system NEVER auto-raises the limit. Publishing
 * too fast is exactly how a POD shop gets banned, so the human stays in the
 * loop on every increase.
 */
const RAMP: Array<{ minAgeDays: number; limit: number }> = [
  { minAgeDays: 0, limit: 5 },
  { minAgeDays: 30, limit: 8 },
  { minAgeDays: 60, limit: 12 },
  { minAgeDays: 90, limit: 18 },
  { minAgeDays: 150, limit: 25 },
  { minAgeDays: 210, limit: 35 },
  { minAgeDays: 300, limit: 45 },
  { minAgeDays: 365, limit: 60 },
];

export interface ListingLimitAdvice {
  shopAgeDays: number | null;
  currentLimit: number;
  recommendedLimit: number;
  canIncrease: boolean;
  reason: string;
}

/** Ban-safe recommended daily-listing ceiling for a given shop age (days). */
export function recommendedLimitForAgeDays(ageDays: number): number {
  let limit = RAMP[0].limit;
  for (const t of RAMP) {
    if (ageDays >= t.minAgeDays) limit = t.limit;
  }
  return limit;
}

/**
 * Recommends a safe max_daily_listings based on how long the shop has been
 * publishing. Uses the earliest published listing as the shop-age anchor,
 * falling back to the earliest recorded order.
 */
export async function recommendDailyListingLimit(): Promise<ListingLimitAdvice> {
  const currentSetting = await db.select().from(settings).where(eq(settings.key, "max_daily_listings")).get();
  const currentLimit = Math.max(1, parseInt(currentSetting?.value ?? "5") || 5);

  const earliestListing = await db
    .select({ publishedAt: listings.publishedAt })
    .from(listings)
    .where(eq(listings.status, "published"))
    .orderBy(asc(listings.publishedAt))
    .limit(1)
    .get();

  let anchor = earliestListing?.publishedAt ?? null;
  if (!anchor) {
    const earliestOrder = await db
      .select({ orderedAt: orders.orderedAt })
      .from(orders)
      .orderBy(asc(orders.orderedAt))
      .limit(1)
      .get();
    anchor = earliestOrder?.orderedAt ?? null;
  }

  if (!anchor) {
    return {
      shopAgeDays: null,
      currentLimit,
      recommendedLimit: Math.min(currentLimit, RAMP[0].limit),
      canIncrease: false,
      reason: `No published listings or orders yet — stay at the new-shop limit (≤${RAMP[0].limit}/day) until you've shipped your first listings and built standing.`,
    };
  }

  const ageDays = Math.max(0, Math.floor((Date.now() - new Date(anchor).getTime()) / 86_400_000));
  const recommendedLimit = recommendedLimitForAgeDays(ageDays);
  const canIncrease = recommendedLimit > currentLimit;

  const reason = canIncrease
    ? `Shop has been publishing for ${ageDays} days. If it's in good standing (no Etsy policy strikes, low cancellations), you can safely raise max_daily_listings from ${currentLimit} to ${recommendedLimit}. Step it up gradually and watch for Etsy rate warnings.`
    : `Shop age ${ageDays} days — current limit ${currentLimit}/day is within the safe range for this stage (ceiling ~${recommendedLimit}/day).`;

  return { shopAgeDays: ageDays, currentLimit, recommendedLimit, canIncrease, reason };
}
