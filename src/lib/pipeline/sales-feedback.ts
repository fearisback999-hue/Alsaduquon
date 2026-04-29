import { eq, desc, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  niches,
  nicheAnalytics,
  orders,
  listings,
  printifyProducts,
  designConcepts,
} from "@/lib/db/schema";

interface NicheRevenue {
  nicheName: string;
  totalRevenue: number;
  totalOrders: number;
  hitRate: number | null;
}

interface TopDesign {
  title: string;
  designType: string | null;
  nicheName: string;
  productType: string;
  orderCount: number;
  revenue: number;
}

interface DesignTypeStats {
  designType: string;
  totalOrders: number;
  totalRevenue: number;
}

export async function getTopNichesByRevenue(limit = 10): Promise<NicheRevenue[]> {
  try {
    const rows = await db
      .select({
        nicheName: niches.name,
        totalRevenue: nicheAnalytics.totalRevenue,
        totalOrders: nicheAnalytics.totalOrders,
        hitRate: nicheAnalytics.nicheHitRate,
      })
      .from(nicheAnalytics)
      .innerJoin(niches, eq(nicheAnalytics.nicheId, niches.id))
      .orderBy(desc(nicheAnalytics.totalRevenue))
      .limit(limit)
      .all();

    return rows.map((r) => ({
      nicheName: r.nicheName,
      totalRevenue: r.totalRevenue ?? 0,
      totalOrders: r.totalOrders ?? 0,
      hitRate: r.hitRate,
    }));
  } catch {
    return [];
  }
}

export async function getTopDesignsByOrders(limit = 10): Promise<TopDesign[]> {
  try {
    const rows = await db
      .select({
        title: designConcepts.title,
        designType: designConcepts.designType,
        nicheName: niches.name,
        productType: printifyProducts.productType,
        orderCount: sql<number>`count(${orders.id})`,
        revenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      })
      .from(orders)
      .innerJoin(listings, eq(orders.listingId, listings.id))
      .innerJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
      .innerJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
      .groupBy(designConcepts.id)
      .orderBy(desc(sql`count(${orders.id})`))
      .limit(limit)
      .all();

    return rows.map((r) => ({
      title: r.title,
      designType: r.designType,
      nicheName: r.nicheName,
      productType: r.productType,
      orderCount: r.orderCount,
      revenue: r.revenue,
    }));
  } catch {
    return [];
  }
}

export async function getDesignTypePerformance(): Promise<DesignTypeStats[]> {
  try {
    const rows = await db
      .select({
        designType: designConcepts.designType,
        totalOrders: sql<number>`count(${orders.id})`,
        totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
      })
      .from(orders)
      .innerJoin(listings, eq(orders.listingId, listings.id))
      .innerJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
      .innerJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
      .groupBy(designConcepts.designType)
      .orderBy(desc(sql`count(${orders.id})`))
      .all();

    return rows.map((r) => ({
      designType: r.designType ?? "unknown",
      totalOrders: r.totalOrders,
      totalRevenue: r.totalRevenue,
    }));
  } catch {
    return [];
  }
}

export async function formatSalesContextForScoring(): Promise<string> {
  const topNiches = await getTopNichesByRevenue(10);

  if (topNiches.length === 0) {
    return "No sales data available yet — rely on market knowledge.";
  }

  const lines = ["TOP PERFORMING NICHES IN OUR STORE:"];
  for (let i = 0; i < topNiches.length; i++) {
    const n = topNiches[i];
    lines.push(
      `${i + 1}. "${n.nicheName}" — $${n.totalRevenue.toFixed(2)} revenue, ${n.totalOrders} orders${n.hitRate != null ? `, ${(n.hitRate * 100).toFixed(0)}% hit rate` : ""}`,
    );
  }
  return lines.join("\n");
}

export async function formatSalesContextForConcepts(nicheName: string): Promise<string> {
  const [topNiches, topDesigns, typeStats] = await Promise.all([
    getTopNichesByRevenue(5),
    getTopDesignsByOrders(5),
    getDesignTypePerformance(),
  ]);

  if (topDesigns.length === 0 && topNiches.length === 0) {
    return "No sales data available yet — create diverse, commercially appealing designs based on market knowledge.";
  }

  const sections: string[] = ["SALES INTELLIGENCE FROM YOUR STORE:"];

  if (typeStats.length > 0) {
    const typeLine = typeStats
      .map((t) => `${t.designType} (${t.totalOrders} orders, $${t.totalRevenue.toFixed(0)})`)
      .join(", ");
    sections.push(`\nBest-selling design types: ${typeLine}`);
  }

  if (topDesigns.length > 0) {
    sections.push("\nTop best-selling designs:");
    for (let i = 0; i < topDesigns.length; i++) {
      const d = topDesigns[i];
      sections.push(
        `${i + 1}. "${d.title}" (${d.designType ?? "hybrid"}, ${d.nicheName} niche, ${d.productType}) — ${d.orderCount} orders, $${d.revenue.toFixed(0)}`,
      );
    }
  }

  if (topNiches.length > 0) {
    const nicheLine = topNiches
      .map((n) => `${n.nicheName} ($${n.totalRevenue.toFixed(0)})`)
      .join(", ");
    sections.push(`\nTop niches by revenue: ${nicheLine}`);
  }

  sections.push(
    `\nCurrent niche: "${nicheName}" — Use the data above to inform style choices, NOT to copy existing designs.`,
  );

  return sections.join("\n");
}
