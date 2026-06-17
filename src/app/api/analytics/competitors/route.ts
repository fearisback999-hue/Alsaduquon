import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/auth/require-session";
import { getCompetitorAnalysis } from "@/lib/analytics/competitor-scraper";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  try {
    const analysis = await getCompetitorAnalysis();

    // Compute summary statistics across all niches
    const totalNiches = analysis.length;
    const totalListings = analysis.reduce((sum, n) => sum + n.listingCount, 0);
    const overallAvgCompetitorPrice = totalListings > 0
      ? Math.round(
          (analysis.reduce((sum, n) => sum + n.avgCompetitorPrice * n.listingCount, 0) / totalListings) * 100,
        ) / 100
      : 0;

    const positionCounts = {
      below: analysis.filter((n) => n.pricePosition === "below").length,
      at: analysis.filter((n) => n.pricePosition === "at").length,
      above: analysis.filter((n) => n.pricePosition === "above").length,
    };

    return NextResponse.json({
      summary: {
        totalNiches,
        totalListingsScraped: totalListings,
        overallAvgCompetitorPrice,
        pricePositionBreakdown: positionCounts,
      },
      niches: analysis,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch competitor analysis" },
      { status: 500 },
    );
  }
}
