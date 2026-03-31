import { db } from "@/lib/db";
import { dailyCosts, costEntries } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { BudgetExceededError, ListingLimitError } from "@/lib/errors";

function today(): string {
  return new Date().toISOString().split("T")[0];
}

export async function getOrCreateDailyCost() {
  const date = today();
  const existing = await db.select().from(dailyCosts).where(eq(dailyCosts.date, date)).get();
  if (existing) return existing;

  const [created] = await db.insert(dailyCosts).values({ date }).returning();
  return created;
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
 * Atomic budget enforcement: checks AND increments in a single SQL statement
 * to prevent TOCTOU race conditions in concurrent requests.
 */
export async function enforceBudget(estimatedCost: number): Promise<void> {
  const date = today();
  const daily = await getOrCreateDailyCost();

  // Atomic check: only update if the new total would be within budget
  const result = await db
    .update(dailyCosts)
    .set({
      totalCost: sql`${dailyCosts.totalCost} + ${estimatedCost}`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      sql`${dailyCosts.date} = ${date} AND ${dailyCosts.totalCost} + ${estimatedCost} <= ${dailyCosts.maxDailyCost}`,
    )
    .returning();

  if (result.length === 0) {
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
 * Atomic listing limit enforcement: checks AND increments in one SQL statement.
 */
export async function enforceListingLimit(): Promise<void> {
  const date = today();
  const daily = await getOrCreateDailyCost();

  const result = await db
    .update(dailyCosts)
    .set({
      listingsCreated: sql`${dailyCosts.listingsCreated} + 1`,
      updatedAt: new Date().toISOString(),
    })
    .where(
      sql`${dailyCosts.date} = ${date} AND ${dailyCosts.listingsCreated} < ${dailyCosts.maxDailyListings}`,
    )
    .returning();

  if (result.length === 0) {
    throw new ListingLimitError(daily.listingsCreated, daily.maxDailyListings);
  }
}

export async function recordCost(
  category: "openai_text" | "openai_image" | "openai_moderation" | "printify" | "etsy_fee" | "trend_api" | "other",
  amount: number,
  options?: { modelName?: string; description?: string; referenceId?: string; referenceType?: string },
): Promise<void> {
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
  const isAI = category.startsWith("openai");
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
