import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyCosts, costEntries, tokenUsages, settings } from "@/lib/db/schema";
import { desc, eq, inArray } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30") || 30, 1), 365);

  const costs = await db
    .select()
    .from(dailyCosts)
    .orderBy(desc(dailyCosts.date))
    .limit(days)
    .all();

  // Today's detail
  const today = new Date().toISOString().split("T")[0];
  const todayEntries = await db
    .select()
    .from(costEntries)
    .where(eq(costEntries.date, today))
    .all();

  // Recent token usage
  const recentTokens = await db
    .select()
    .from(tokenUsages)
    .orderBy(desc(tokenUsages.createdAt))
    .limit(50)
    .all();

  // Live settings for budget display — used as fallback when today's row
  // doesn't exist or as the source of truth shown in the UI
  const limitSettings = await db
    .select()
    .from(settings)
    .where(inArray(settings.key, ["max_daily_cost", "max_daily_listings"]))
    .all();
  const settingMap: Record<string, string> = {};
  for (const s of limitSettings) settingMap[s.key] = s.value;

  return NextResponse.json({
    dailyCosts: costs,
    todayEntries,
    recentTokenUsage: recentTokens,
    limits: {
      maxDailyCost: Number(settingMap.max_daily_cost) || 50,
      maxDailyListings: Number(settingMap.max_daily_listings) || 25,
    },
  });
}
