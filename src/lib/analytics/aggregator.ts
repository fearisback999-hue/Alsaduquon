import { db } from "@/lib/db";
import {
  niches, designConcepts, listings, orders,
  nicheAnalytics, dailyAnalytics, dailyCosts,
} from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";

export async function aggregateNicheAnalytics(): Promise<void> {
  const allNiches = await db.select().from(niches).where(eq(niches.status, "approved")).all();

  for (const niche of allNiches) {
    const concepts = await db.select().from(designConcepts).where(eq(designConcepts.nicheId, niche.id)).all();
    const conceptIds = concepts.map((c) => c.id);

    if (conceptIds.length === 0) continue;

    // Count listings and orders for this niche
    let totalListings = 0;
    let totalOrders = 0;
    let totalRevenue = 0;
    let totalProfit = 0;

    for (const concept of concepts) {
      const conceptListings = await db
        .select()
        .from(listings)
        .where(eq(listings.printifyProductId, concept.id)) // approximate — join through products
        .all();

      totalListings += conceptListings.length;

      for (const listing of conceptListings) {
        const listingOrders = await db
          .select()
          .from(orders)
          .where(eq(orders.listingId, listing.id))
          .all();

        totalOrders += listingOrders.length;
        totalRevenue += listingOrders.reduce((sum, o) => sum + o.revenue, 0);
        totalProfit += listingOrders.reduce((sum, o) => sum + (o.profit ?? 0), 0);
      }
    }

    const nicheHitRate = totalListings > 0 ? totalOrders / totalListings : null;
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : null;

    // Upsert niche analytics
    const existing = await db.select().from(nicheAnalytics).where(eq(nicheAnalytics.nicheId, niche.id)).get();

    const data = {
      totalDesigns: concepts.length,
      totalListings,
      totalOrders,
      totalRevenue,
      totalProfit,
      nicheHitRate,
      avgOrderValue,
      costPerListing: totalListings > 0 ? 0 : null, // Would need to join cost data
      updatedAt: new Date().toISOString(),
    };

    if (existing) {
      await db.update(nicheAnalytics).set(data).where(eq(nicheAnalytics.id, existing.id));
    } else {
      await db.insert(nicheAnalytics).values({ nicheId: niche.id, ...data });
    }
  }
}

export async function aggregateDailyAnalytics(date: string): Promise<void> {
  // Get today's counts from various tables
  const todayListingsPublished = await db
    .select({ count: sql<number>`count(*)` })
    .from(listings)
    .where(eq(listings.publishedAt, date))
    .get();

  const todayOrders = await db
    .select({
      count: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(revenue), 0)`,
      profit: sql<number>`coalesce(sum(profit), 0)`,
    })
    .from(orders)
    .where(sql`date(${orders.orderedAt}) = ${date}`)
    .get();

  const todayCost = await db
    .select()
    .from(dailyCosts)
    .where(eq(dailyCosts.date, date))
    .get();

  const existing = await db.select().from(dailyAnalytics).where(eq(dailyAnalytics.date, date)).get();

  const data = {
    listingsPublished: todayListingsPublished?.count ?? 0,
    ordersReceived: todayOrders?.count ?? 0,
    totalRevenue: todayOrders?.revenue ?? 0,
    totalCost: todayCost?.totalCost ?? 0,
    totalProfit: (todayOrders?.revenue ?? 0) - (todayCost?.totalCost ?? 0),
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db.update(dailyAnalytics).set(data).where(eq(dailyAnalytics.id, existing.id));
  } else {
    await db.insert(dailyAnalytics).values({ date, ...data });
  }
}
