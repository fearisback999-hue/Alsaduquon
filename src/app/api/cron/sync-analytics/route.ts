import { NextRequest, NextResponse } from "next/server";
import { aggregateNicheAnalytics, aggregateDailyAnalytics } from "@/lib/analytics/aggregator";
import { syncListingMetrics } from "@/lib/analytics/listing-metrics";
import { syncCustomerReviews } from "@/lib/analytics/review-monitor";
import { log } from "@/lib/logger";
import { verifyCronSecret } from "@/lib/auth/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  try {
    const today = new Date().toISOString().split("T")[0];

    await aggregateNicheAnalytics();
    await aggregateDailyAnalytics(today);
    await syncListingMetrics();

    const reviewSync = await syncCustomerReviews();

    log("info", `Analytics sync completed for ${today}`);
    return NextResponse.json({ success: true, date: today, reviews: reviewSync });
  } catch (error) {
    log("error", "Analytics sync failed", { error: error instanceof Error ? error.message : String(error) });
    const message = process.env.NODE_ENV === "production"
      ? "Internal server error"
      : error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: message },
      { status: 500 },
    );
  }
}
