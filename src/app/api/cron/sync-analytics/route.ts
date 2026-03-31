import { NextResponse } from "next/server";
import { aggregateNicheAnalytics, aggregateDailyAnalytics } from "@/lib/analytics/aggregator";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  try {
    const today = new Date().toISOString().split("T")[0];

    await aggregateNicheAnalytics();
    await aggregateDailyAnalytics(today);

    log("info", `Analytics sync completed for ${today}`);
    return NextResponse.json({ success: true, date: today });
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
