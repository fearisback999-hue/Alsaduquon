import { NextRequest, NextResponse } from "next/server";
import { aggregateNicheAnalytics, aggregateDailyAnalytics } from "@/lib/analytics/aggregator";
import { syncListingMetrics } from "@/lib/analytics/listing-metrics";
import { syncCustomerReviews } from "@/lib/analytics/review-monitor";
import { captureAllActiveNiches } from "@/lib/research/demand-velocity";
import { trainScoringWeights } from "@/lib/research/niche-learning";
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

    // Capture demand velocity snapshots for all active niches
    const velocitySync = await captureAllActiveNiches();
    log("info", `Demand velocity: ${velocitySync.snapshotted} snapshots, ${velocitySync.updated} scores updated`);

    // Re-train scoring weights from sales outcome data (weekly is fine)
    const dayOfWeek = new Date().getDay();
    let learningResult = null;
    if (dayOfWeek === 0) {
      learningResult = await trainScoringWeights();
      log("info", `Niche learning: trained=${learningResult.trained}, samples=${learningResult.sampleSize}`);
    }

    log("info", `Analytics sync completed for ${today}`);
    return NextResponse.json({
      success: true,
      date: today,
      reviews: reviewSync,
      velocity: velocitySync,
      learning: learningResult,
    });
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
