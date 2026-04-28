import { db } from "@/lib/db";
import { dailyCosts, costEntries, settings } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { BudgetExceededError, ListingLimitError } from "@/lib/errors";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

async function readNumericSetting(key: string, fallback: number): Promise<number> {
  const row = await db.select().from(settings).where(eq(settings.key, key)).get();
  if (!row) return fallback;
  const n = Number(row.value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export async function getOrCreateDailyCost() {
  const date = today();
  const existing = await db.select().from(dailyCosts).where(eq(dailyCosts.date, date)).get();
  if (existing) return existing;

  // Seed today's row from the user's saved settings — NOT the schema default.
  // The schema default is only a safety net if settings haven't been seeded.
  const [maxDailyCost, maxDailyListings] = await Promise.all([
    readNumericSetting("max_daily_cost", 50),
    readNumericSetting("max_daily_listings", 25),
  ]);

  // Race-safe insert: if another process created the row between our check
  // and our insert (common at midnight rollover), onConflictDoNothing
  // swallows the unique-constraint error. We then re-read the existing row.
  await db.insert(dailyCosts).values({
    date,
    maxDailyCost,
    maxDailyListings: Math.floor(maxDailyListings),
  }).onConflictDoNothing().run();
  const row = await db.select().from(dailyCosts).where(eq(dailyCosts.date, date)).get();
  if (!row) {
    throw new Error(`Failed to create or read daily_costs row for ${date}`);
  }
  return row;
}

export async function checkBudget(): Promise<{ remaining: number; used: number; max: number }> {
  const daily = await getOrCreateDailyCost();
  return {
    remaining: daily.maxDailyCost - daily.totalCost,
    used: daily.totalCost,
    max: daily.maxDailyCost,
  };
}

export async function canAfford(estimatedCost: number): Promise<boolean> {
  const { remaining } = await checkBudget();
  return remaining >= estimatedCost;
}

/**
 * Budget enforcement: throws if estimated spend would exceed the daily cap.
 * Does NOT increment totalCost — recordCost() is the single source of truth
 * for actual spend. Call this as a pre-flight check before expensive ops.
 */
export async function enforceBudget(estimatedCost: number): Promise<void> {
  const daily = await getOrCreateDailyCost();
  if (daily.totalCost + estimatedCost > daily.maxDailyCost) {
    throw new BudgetExceededError(daily.totalCost + estimatedCost, daily.maxDailyCost);
  }
}

// Keep old name as alias for backwards compatibility
export const enforcebudget = enforceBudget;

export async function checkListingLimit(): Promise<{ remaining: number; used: number; max: number }> {
  const daily = await getOrCreateDailyCost();
  return {
    remaining: daily.maxDailyListings - daily.listingsCreated,
    used: daily.listingsCreated,
    max: daily.maxDailyListings,
  };
}

/**
 * Listing limit enforcement: throws if already at the daily cap.
 * Does NOT increment — incrementListingCount() is called on successful publish.
 */
export async function enforceListingLimit(): Promise<void> {
  const daily = await getOrCreateDailyCost();
  if (daily.listingsCreated >= daily.maxDailyListings) {
    throw new ListingLimitError(daily.listingsCreated, daily.maxDailyListings);
  }
}

export async function recordCost(
  category: "openai_text" | "openai_image" | "openai_moderation" | "anthropic_text" | "replicate_image" | "printify" | "etsy_fee" | "trend_api" | "other",
  amount: number,
  options?: { modelName?: string; description?: string; referenceId?: string; referenceType?: string },
): Promise<void> {
  // Guard against bogus amounts that would corrupt the daily total. A bug
  // producing a negative cost would artificially free up budget.
  if (!Number.isFinite(amount) || amount < 0) {
    return;
  }

  const date = today();
  await getOrCreateDailyCost();

  // Record the line item
  await db.insert(costEntries).values({
    date,
    category,
    amount,
    modelName: options?.modelName,
    description: options?.description,
    referenceId: options?.referenceId,
    referenceType: options?.referenceType,
  });

  // Atomic update of daily totals
  const isAI = category === "openai_text" || category === "openai_image" || category === "openai_moderation"
    || category === "anthropic_text" || category === "replicate_image";
  const isAPI = category === "printify" || category === "trend_api";
  const isFee = category === "etsy_fee";

  await db
    .update(dailyCosts)
    .set({
      totalCost: sql`${dailyCosts.totalCost} + ${amount}`,
      aiCost: sql`${dailyCosts.aiCost} + ${isAI ? amount : 0}`,
      apiCost: sql`${dailyCosts.apiCost} + ${isAPI ? amount : 0}`,
      listingFees: sql`${dailyCosts.listingFees} + ${isFee ? amount : 0}`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dailyCosts.date, date));
}

export async function incrementListingCount(): Promise<void> {
  const date = today();
  await getOrCreateDailyCost();
  await db
    .update(dailyCosts)
    .set({
      listingsCreated: sql`${dailyCosts.listingsCreated} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dailyCosts.date, date));
}
