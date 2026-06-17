import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { forecastAnnualRevenue } from "@/lib/analytics/revenue-forecast";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

const DEFAULT_ANNUAL_GOAL = 150_000;

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const goalSetting = await db.select().from(settings).where(eq(settings.key, "annual_revenue_goal")).get();
  const annualGoal = goalSetting ? parseFloat(goalSetting.value) || DEFAULT_ANNUAL_GOAL : DEFAULT_ANNUAL_GOAL;

  const forecast = await forecastAnnualRevenue();

  const goalProgress = {
    goal: annualGoal,
    projected: forecast.projectedAnnual,
    progressPercent: annualGoal > 0
      ? Math.round((forecast.projectedAnnual / annualGoal) * 1000) / 10
      : 0,
    onTrack: forecast.projectedAnnual >= annualGoal,
    gap: Math.round((forecast.projectedAnnual - annualGoal) * 100) / 100,
  };

  return NextResponse.json({
    projectedAnnual: forecast.projectedAnnual,
    confidence: forecast.confidence,
    method: forecast.method,
    monthlyTrend: forecast.monthlyTrend,
    goalProgress,
  });
}
