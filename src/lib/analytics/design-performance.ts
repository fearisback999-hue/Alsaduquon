import { db } from "@/lib/db";
import {
  orders,
  listings,
  printifyProducts,
  designConcepts,
  niches,
  listingMetrics,
  nicheAnalytics,
  generatedImages,
} from "@/lib/db/schema";
import { eq, desc, sql, gte, and } from "drizzle-orm";
import { log } from "@/lib/logger";

interface DesignPerformance {
  conceptId: string;
  title: string;
  designType: string;
  styleCategory: string;
  nicheName: string;
  productType: string;
  totalOrders: number;
  totalRevenue: number;
  totalViews: number;
  conversionRate: number;
  avgOrderValue: number;
}

interface NicheVelocity {
  nicheId: string;
  nicheName: string;
  orders7d: number;
  orders30d: number;
  revenue7d: number;
  revenue30d: number;
  velocity: "accelerating" | "stable" | "declining" | "dead";
}

interface ProductTypePerformance {
  productType: string;
  nicheName: string;
  totalOrders: number;
  totalRevenue: number;
  avgConversionRate: number;
}

/**
 * Full design-level performance data.
 * Joins all the way from orders → listings → products → concepts → niches.
 */
export async function getDesignPerformance(limit = 50): Promise<DesignPerformance[]> {
  try {
    const rows = await db
      .select({
        conceptId: designConcepts.id,
        title: designConcepts.title,
        designType: designConcepts.designType,
        colorPalette: designConcepts.colorPalette,
        nicheName: niches.name,
        productType: printifyProducts.productType,
        totalOrders: sql<number>`count(distinct ${orders.id})`,
        totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
        totalViews: sql<number>`coalesce(max(${listingMetrics.views}), 0)`,
        conversionRate: sql<number>`coalesce(max(${listingMetrics.conversionRate}), 0)`,
      })
      .from(designConcepts)
      .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
      .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
      .leftJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
      .leftJoin(orders, eq(orders.listingId, listings.id))
      .leftJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
      .where(eq(designConcepts.status, "generated"))
      .groupBy(designConcepts.id, printifyProducts.productType)
      .orderBy(desc(sql`count(distinct ${orders.id})`))
      .limit(limit)
      .all();

    return rows.map((r) => {
      let styleCategory = "unknown";
      try {
        const palette = JSON.parse(r.colorPalette ?? "{}");
        styleCategory = palette.style_category ?? "unknown";
      } catch { /* ignore */ }

      return {
        conceptId: r.conceptId,
        title: r.title,
        designType: r.designType ?? "hybrid",
        styleCategory,
        nicheName: r.nicheName,
        productType: r.productType,
        totalOrders: r.totalOrders,
        totalRevenue: r.totalRevenue,
        totalViews: r.totalViews,
        conversionRate: r.conversionRate,
        avgOrderValue: r.totalOrders > 0 ? r.totalRevenue / r.totalOrders : 0,
      };
    });
  } catch (error) {
    log("error", "Failed to get design performance", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Time-windowed niche velocity: compare last 7 days vs last 30 days.
 * Identifies accelerating, stable, declining, and dead niches.
 */
export async function getNicheVelocity(): Promise<NicheVelocity[]> {
  const now = Date.now();
  const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();

  try {
    const rows = await db
      .select({
        nicheId: niches.id,
        nicheName: niches.name,
        orders7d: sql<number>`count(distinct case when ${orders.orderedAt} >= ${sevenDaysAgo} then ${orders.id} end)`,
        orders30d: sql<number>`count(distinct case when ${orders.orderedAt} >= ${thirtyDaysAgo} then ${orders.id} end)`,
        revenue7d: sql<number>`coalesce(sum(case when ${orders.orderedAt} >= ${sevenDaysAgo} then ${orders.revenue} else 0 end), 0)`,
        revenue30d: sql<number>`coalesce(sum(case when ${orders.orderedAt} >= ${thirtyDaysAgo} then ${orders.revenue} else 0 end), 0)`,
      })
      .from(niches)
      .innerJoin(designConcepts, eq(designConcepts.nicheId, niches.id))
      .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
      .leftJoin(orders, eq(orders.listingId, listings.id))
      .where(eq(listings.status, "published"))
      .groupBy(niches.id)
      .all();

    return rows.map((r) => {
      // Weekly run rate compared to monthly average
      const weeklyRate = r.orders7d;
      const monthlyWeeklyAvg = r.orders30d / 4.3;

      let velocity: NicheVelocity["velocity"];
      if (r.orders30d === 0) {
        velocity = "dead";
      } else if (weeklyRate > monthlyWeeklyAvg * 1.5) {
        velocity = "accelerating";
      } else if (weeklyRate < monthlyWeeklyAvg * 0.5) {
        velocity = "declining";
      } else {
        velocity = "stable";
      }

      return {
        nicheId: r.nicheId,
        nicheName: r.nicheName,
        orders7d: r.orders7d,
        orders30d: r.orders30d,
        revenue7d: r.revenue7d,
        revenue30d: r.revenue30d,
        velocity,
      };
    });
  } catch (error) {
    log("error", "Failed to get niche velocity", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Product-type performance by niche: which products sell best in which niches.
 * Used to optimize product-mix selection in Step 06.
 */
export async function getProductTypePerformanceByNiche(): Promise<ProductTypePerformance[]> {
  try {
    const rows = await db
      .select({
        productType: printifyProducts.productType,
        nicheName: niches.name,
        totalOrders: sql<number>`count(distinct ${orders.id})`,
        totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
        avgConversionRate: sql<number>`coalesce(avg(${listingMetrics.conversionRate}), 0)`,
      })
      .from(printifyProducts)
      .innerJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
      .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
      .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
      .leftJoin(orders, eq(orders.listingId, listings.id))
      .leftJoin(listingMetrics, eq(listingMetrics.listingId, listings.id))
      .where(eq(listings.status, "published"))
      .groupBy(printifyProducts.productType, niches.name)
      .orderBy(desc(sql`count(distinct ${orders.id})`))
      .all();

    return rows.map((r) => ({
      productType: r.productType,
      nicheName: r.nicheName,
      totalOrders: r.totalOrders,
      totalRevenue: r.totalRevenue,
      avgConversionRate: r.avgConversionRate,
    }));
  } catch (error) {
    log("error", "Failed to get product type performance", { error: error instanceof Error ? error.message : String(error) });
    return [];
  }
}

/**
 * Formats design performance data as prompt context for Step 03 concept generation.
 * Tells the AI which style + design type combos actually sell in this niche.
 */
export async function formatDesignPerformanceForConcepts(nicheName: string): Promise<string> {
  const [designs, productPerf] = await Promise.all([
    getDesignPerformance(20),
    getProductTypePerformanceByNiche(),
  ]);

  if (designs.length === 0) return "";

  const sections: string[] = [];

  // Design styles that sell in this specific niche
  const nicheDesigns = designs.filter((d) => d.nicheName.toLowerCase() === nicheName.toLowerCase() && d.totalOrders > 0);
  if (nicheDesigns.length > 0) {
    const styleBreakdown = nicheDesigns.map((d) => `${d.designType}/${d.styleCategory}: ${d.totalOrders} orders`).join(", ");
    sections.push(`WINNING STYLES IN THIS NICHE: ${styleBreakdown}`);
  }

  // Global top design styles
  const styleMap = new Map<string, { orders: number; revenue: number }>();
  for (const d of designs) {
    if (d.totalOrders === 0) continue;
    const key = `${d.designType}/${d.styleCategory}`;
    const existing = styleMap.get(key) ?? { orders: 0, revenue: 0 };
    existing.orders += d.totalOrders;
    existing.revenue += d.totalRevenue;
    styleMap.set(key, existing);
  }

  if (styleMap.size > 0) {
    const sorted = Array.from(styleMap.entries()).sort((a, b) => b[1].orders - a[1].orders).slice(0, 5);
    const topStyles = sorted.map(([style, stats]) => `${style} (${stats.orders} orders, $${stats.revenue.toFixed(0)})`).join(", ");
    sections.push(`TOP SELLING DESIGN STYLES GLOBALLY: ${topStyles}`);
  }

  // Product types that sell in this niche
  const nicheProducts = productPerf.filter((p) => p.nicheName.toLowerCase() === nicheName.toLowerCase() && p.totalOrders > 0);
  if (nicheProducts.length > 0) {
    const productBreakdown = nicheProducts
      .sort((a, b) => b.totalOrders - a.totalOrders)
      .map((p) => `${p.productType}: ${p.totalOrders} orders, ${p.avgConversionRate.toFixed(1)}% conversion`)
      .join(", ");
    sections.push(`BEST PRODUCT TYPES FOR THIS NICHE: ${productBreakdown}`);
  }

  return sections.length > 0 ? "\nDESIGN PERFORMANCE DATA:\n" + sections.join("\n") : "";
}

/**
 * Returns the recent image-quality rejection rate for a niche.
 * Used by Step 03 to skip concept generation for niches whose images
 * keep failing the quality gate — saving budget and operator time.
 *
 * Looks at the last `lookbackDays` worth of generatedImages rows joined
 * back to designConcepts → niches. Returns rejectionRate as a fraction
 * (0..1) and totalAttempts so the caller can require a minimum sample
 * before acting on the signal.
 */
export async function getNicheImageRejectionRate(
  nicheId: string,
  lookbackDays = 30,
): Promise<{ rejectionRate: number; totalAttempts: number }> {
  const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();

  try {
    const row = await db
      .select({
        rejected: sql<number>`sum(case when ${generatedImages.status} = 'rejected' then 1 else 0 end)`,
        total: sql<number>`count(*)`,
      })
      .from(generatedImages)
      .innerJoin(designConcepts, eq(generatedImages.designConceptId, designConcepts.id))
      .where(and(eq(designConcepts.nicheId, nicheId), gte(generatedImages.createdAt, cutoff)))
      .get();

    const total = row?.total ?? 0;
    const rejected = row?.rejected ?? 0;
    if (total === 0) return { rejectionRate: 0, totalAttempts: 0 };
    return { rejectionRate: rejected / total, totalAttempts: total };
  } catch (error) {
    log("error", "Failed to compute niche image rejection rate", {
      error: error instanceof Error ? error.message : String(error),
    });
    return { rejectionRate: 0, totalAttempts: 0 };
  }
}

/**
 * Formats niche velocity data for Step 02 scoring.
 * Gives the scoring AI real-time sales momentum data.
 */
export async function formatNicheVelocityForScoring(): Promise<string> {
  const velocities = await getNicheVelocity();
  if (velocities.length === 0) return "";

  const accelerating = velocities.filter((v) => v.velocity === "accelerating");
  const declining = velocities.filter((v) => v.velocity === "declining");
  const dead = velocities.filter((v) => v.velocity === "dead");

  const sections: string[] = ["\nREAL-TIME NICHE VELOCITY (last 30 days):"];

  if (accelerating.length > 0) {
    const accelList = accelerating
      .sort((a, b) => b.revenue7d - a.revenue7d)
      .slice(0, 5)
      .map((v) => `"${v.nicheName}" ($${v.revenue7d.toFixed(0)}/week, ${v.orders7d} orders this week)`)
      .join(", ");
    sections.push(`ACCELERATING: ${accelList}`);
  }

  if (declining.length > 0) {
    const declineList = declining.slice(0, 5).map((v) => `"${v.nicheName}"`).join(", ");
    sections.push(`DECLINING (avoid similar): ${declineList}`);
  }

  if (dead.length > 0) {
    sections.push(`DEAD NICHES (${dead.length} with zero 30-day sales) — avoid these and similar keywords`);
  }

  return sections.join("\n");
}
