import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyAnalytics, nicheAnalytics, niches, etsyListings, orders } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "30") || 30, 1), 365);

  const daily = await db
    .select()
    .from(dailyAnalytics)
    .orderBy(desc(dailyAnalytics.date))
    .limit(days)
    .all();

  // Summary stats
  const totalListings = await db.select({ count: sql<number>`count(*)` }).from(etsyListings).where(eq(etsyListings.status, "published")).get();
  const totalOrders = await db.select({ count: sql<number>`count(*)` }).from(orders).get();
  const totalRevenue = await db.select({ sum: sql<number>`coalesce(sum(revenue), 0)` }).from(orders).get();
  const totalProfit = await db.select({ sum: sql<number>`coalesce(sum(profit), 0)` }).from(orders).get();

  // Top niches
  const topNiches = await db
    .select()
    .from(nicheAnalytics)
    .orderBy(desc(nicheAnalytics.totalRevenue))
    .limit(10)
    .all();

  return NextResponse.json({
    dailyAnalytics: daily,
    summary: {
      liveListings: totalListings?.count ?? 0,
      totalOrders: totalOrders?.count ?? 0,
      totalRevenue: totalRevenue?.sum ?? 0,
      totalProfit: totalProfit?.sum ?? 0,
    },
    topNiches,
  });
}
