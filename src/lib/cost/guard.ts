import { db } from "@/lib/db";
import { dailyCosts, costEntries } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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

export async function enforcebudget(estimatedCost: number): Promise<void> {
  const budget = await checkBudget();
  if (budget.remaining < estimatedCost) {
    throw new BudgetExceededError(budget.used + estimatedCost, budget.max);
  }
}

export async function checkListingLimit(): Promise<{ remaining: number; used: number; max: number }> {
  const daily = await getOrCreateDailyCost();
  return {
    remaining: daily.maxDailyListings - daily.listingsCreated,
    used: daily.listingsCreated,
    max: daily.maxDailyListings,
  };
}

export async function enforceListingLimit(): Promise<void> {
  const limit = await checkListingLimit();
  if (limit.remaining <= 0) {
    throw new ListingLimitError(limit.used, limit.max);
  }
}

export async function recordCost(
  category: "openai_text" | "openai_image" | "openai_moderation" | "printify" | "etsy_fee" | "trend_api" | "other",
  amount: number,
  options?: { modelName?: string; description?: string; referenceId?: string; referenceType?: string },
): Promise<void> {
  const date = today();
  const daily = await getOrCreateDailyCost();

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

  // Update daily totals
  const isAI = category.startsWith("openai");
  const isAPI = category === "printify" || category === "trend_api";
  const isFee = category === "etsy_fee";

  await db
    .update(dailyCosts)
    .set({
      totalCost: daily.totalCost + amount,
      aiCost: daily.aiCost + (isAI ? amount : 0),
      apiCost: daily.apiCost + (isAPI ? amount : 0),
      listingFees: daily.listingFees + (isFee ? amount : 0),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dailyCosts.id, daily.id));
}

export async function incrementListingCount(): Promise<void> {
  const daily = await getOrCreateDailyCost();
  await db
    .update(dailyCosts)
    .set({
      listingsCreated: daily.listingsCreated + 1,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(dailyCosts.id, daily.id));
}
