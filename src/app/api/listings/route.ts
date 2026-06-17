import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listings, printifyProducts, listingMetrics } from "@/lib/db/schema";
import { eq, desc, sql, and } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["draft", "pending_approval", "approved", "rejected", "published", "deactivated"] as const;
const VALID_PLATFORMS = ["etsy", "shopify", "tiktok", "depop", "redbubble", "amazon"] as const;

export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const platform = searchParams.get("platform");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1), 100);
  const offset = Math.max(parseInt(searchParams.get("offset") ?? "0") || 0, 0);

  if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }
  if (platform && !VALID_PLATFORMS.includes(platform as typeof VALID_PLATFORMS[number])) {
    return NextResponse.json({ error: "Invalid platform filter" }, { status: 400 });
  }

  const conditions = [];
  if (status) conditions.push(eq(listings.status, status as typeof VALID_STATUSES[number]));
  if (platform) conditions.push(eq(listings.platform, platform as typeof VALID_PLATFORMS[number]));
  const condition = conditions.length > 0 ? and(...conditions) : sql`1=1`;

  const rows = await db
    .select({
      id: listings.id,
      platform: listings.platform,
      title: listings.title,
      status: listings.status,
      finalPrice: listings.finalPrice,
      externalUrl: listings.externalUrl,
      seoScore: listings.seoScore,
      publishedAt: listings.publishedAt,
      createdAt: listings.createdAt,
      productType: printifyProducts.productType,
      views: listingMetrics.views,
      favorites: listingMetrics.favorites,
      sales: listingMetrics.sales,
      conversionRate: listingMetrics.conversionRate,
    })
    .from(listings)
    .leftJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
    .leftJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
    .where(condition!)
    .orderBy(desc(listings.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ listings: rows });
}
