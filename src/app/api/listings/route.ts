import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { etsyListings, printifyProducts, listingMetrics } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["draft", "pending_approval", "approved", "rejected", "published", "deactivated"] as const;

export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0") || 0, 0);

  // Validate status enum if provided
  if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const condition = status
    ? eq(etsyListings.status, status as typeof VALID_STATUSES[number])
    : sql`1=1`;

  const rows = await db
    .select({
      id: etsyListings.id,
      title: etsyListings.title,
      status: etsyListings.status,
      finalPrice: etsyListings.finalPrice,
      etsyUrl: etsyListings.etsyUrl,
      seoScore: etsyListings.seoScore,
      publishedAt: etsyListings.publishedAt,
      createdAt: etsyListings.createdAt,
      productType: printifyProducts.productType,
      views: listingMetrics.views,
      favorites: listingMetrics.favorites,
      sales: listingMetrics.sales,
      conversionRate: listingMetrics.conversionRate,
    })
    .from(etsyListings)
    .leftJoin(printifyProducts, eq(etsyListings.printifyProductId, printifyProducts.id))
    .leftJoin(listingMetrics, eq(listingMetrics.etsyListingId, etsyListings.id))
    .where(condition)
    .orderBy(desc(etsyListings.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ listings: rows });
}
