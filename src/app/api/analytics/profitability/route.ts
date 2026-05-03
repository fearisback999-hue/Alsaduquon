import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { niches, designConcepts, printifyProducts, listings, orders, listingMetrics } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const nicheProfit = await db
    .select({
      nicheId: niches.id,
      nicheName: niches.name,
      nicheStatus: niches.status,
      totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      totalCost: sql<number>`coalesce(sum(${orders.cost}), 0)`,
      totalProfit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      totalOrders: sql<number>`count(distinct ${orders.id})`,
      totalListings: sql<number>`count(distinct ${listings.id})`,
      avgConversion: sql<number>`coalesce(avg(${listingMetrics.conversionRate}), 0)`,
      totalViews: sql<number>`coalesce(sum(${listingMetrics.views}), 0)`,
    })
    .from(niches)
    .innerJoin(designConcepts, eq(designConcepts.nicheId, niches.id))
    .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
    .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
    .leftJoin(orders, eq(orders.listingId, listings.id))
    .leftJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
    .where(eq(listings.status, "published"))
    .groupBy(niches.id)
    .orderBy(desc(sql`coalesce(sum(${orders.profit}), 0)`))
    .all();

  const productTypeProfit = await db
    .select({
      productType: printifyProducts.productType,
      totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      totalProfit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      totalOrders: sql<number>`count(distinct ${orders.id})`,
      avgMargin: sql<number>`case when sum(${orders.revenue}) > 0 then (sum(${orders.profit}) / sum(${orders.revenue})) * 100 else 0 end`,
    })
    .from(printifyProducts)
    .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
    .leftJoin(orders, eq(orders.listingId, listings.id))
    .where(eq(listings.status, "published"))
    .groupBy(printifyProducts.productType)
    .orderBy(desc(sql`coalesce(sum(${orders.profit}), 0)`))
    .all();

  const designStyleProfit = await db
    .select({
      designType: designConcepts.designType,
      totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      totalProfit: sql<number>`coalesce(sum(${orders.profit}), 0)`,
      totalOrders: sql<number>`count(distinct ${orders.id})`,
    })
    .from(designConcepts)
    .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
    .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
    .leftJoin(orders, eq(orders.listingId, listings.id))
    .where(eq(listings.status, "published"))
    .groupBy(designConcepts.designType)
    .orderBy(desc(sql`coalesce(sum(${orders.profit}), 0)`))
    .all();

  return NextResponse.json({
    nicheProfit: nicheProfit.map((n) => ({
      ...n,
      profitPerListing: n.totalListings > 0 ? n.totalProfit / n.totalListings : 0,
      profitPerOrder: n.totalOrders > 0 ? n.totalProfit / n.totalOrders : 0,
      revenuePerView: n.totalViews > 0 ? n.totalRevenue / n.totalViews : 0,
    })),
    productTypeProfit,
    designStyleProfit,
  });
}
