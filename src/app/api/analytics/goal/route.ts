import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orders, settings } from "@/lib/db/schema";
import { sql, gte, eq } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

const DEFAULT_ANNUAL_GOAL = 150_000;

/**
 * Goal tracking endpoint — returns progress toward annual revenue target.
 * Shows current month run rate, projected annual, and required daily/monthly
 * profit to hit the goal.
 */
export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const goalSetting = await db.select().from(settings).where(eq(settings.key, "annual_revenue_goal")).get();
  const annualGoal = goalSetting ? parseFloat(goalSetting.value) || DEFAULT_ANNUAL_GOAL : DEFAULT_ANNUAL_GOAL;

  const now = new Date();
  const startOfYear = new Date(now.getFullYear(), 0, 1).toISOString();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const [ytd, mtd, last30d, last7d] = await Promise.all([
    db.select({
      revenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      profit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      orderCount: sql<number>`count(*)`,
    }).from(orders).where(gte(orders.orderedAt, startOfYear)).get(),
    db.select({
      revenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      profit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      orderCount: sql<number>`count(*)`,
    }).from(orders).where(gte(orders.orderedAt, startOfMonth)).get(),
    db.select({
      revenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      profit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      orderCount: sql<number>`count(*)`,
    }).from(orders).where(gte(orders.orderedAt, thirtyDaysAgo)).get(),
    db.select({
      revenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      profit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      orderCount: sql<number>`count(*)`,
    }).from(orders).where(gte(orders.orderedAt, sevenDaysAgo)).get(),
  ]);

  const dayOfYear = Math.floor((Date.now() - new Date(now.getFullYear(), 0, 1).getTime()) / (24 * 60 * 60 * 1000)) + 1;
  const dailyAvgYTD = (ytd?.revenue ?? 0) / dayOfYear;
  const projectedAnnual = dailyAvgYTD * 365;

  const monthlyTarget = annualGoal / 12;
  const dailyTarget = annualGoal / 365;
  const last30dDailyAvg = (last30d?.revenue ?? 0) / 30;
  const last7dDailyAvg = (last7d?.revenue ?? 0) / 7;

  const remainingThisYear = Math.max(0, annualGoal - (ytd?.revenue ?? 0));
  const daysLeftInYear = Math.max(1, 365 - dayOfYear);
  const requiredDailyToHitGoal = remainingThisYear / daysLeftInYear;

  return NextResponse.json({
    goal: {
      annual: annualGoal,
      monthly: monthlyTarget,
      daily: dailyTarget,
    },
    actuals: {
      ytdRevenue: ytd?.revenue ?? 0,
      ytdProfit: ytd?.profit ?? 0,
      ytdOrders: ytd?.orderCount ?? 0,
      mtdRevenue: mtd?.revenue ?? 0,
      mtdProfit: mtd?.profit ?? 0,
      mtdOrders: mtd?.orderCount ?? 0,
      last30dRevenue: last30d?.revenue ?? 0,
      last30dProfit: last30d?.profit ?? 0,
      last7dRevenue: last7d?.revenue ?? 0,
    },
    pacing: {
      dayOfYear,
      daysLeftInYear,
      dailyAvgYTD: Math.round(dailyAvgYTD * 100) / 100,
      last30dDailyAvg: Math.round(last30dDailyAvg * 100) / 100,
      last7dDailyAvg: Math.round(last7dDailyAvg * 100) / 100,
      projectedAnnual: Math.round(projectedAnnual * 100) / 100,
      progressPercent: Math.round(((ytd?.revenue ?? 0) / annualGoal) * 1000) / 10,
      onPace: projectedAnnual >= annualGoal,
      requiredDailyToHitGoal: Math.round(requiredDailyToHitGoal * 100) / 100,
      gapToTarget: Math.round((requiredDailyToHitGoal - last7dDailyAvg) * 100) / 100,
    },
  });
}
