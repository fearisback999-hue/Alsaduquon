import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { sql, gte } from "drizzle-orm";

const SEASONAL_FACTORS: Record<number, number> = {
  1: 0.7,   // January post-holiday slump
  2: 0.75,  // February slow
  3: 0.85,  // March pickup
  4: 0.9,   // April steady
  5: 0.95,  // May steady
  6: 0.85,  // June summer dip
  7: 0.8,   // July summer dip
  8: 0.9,   // August back-to-school
  9: 1.0,   // September steady
  10: 1.15, // October pre-holiday
  11: 1.4,  // November Black Friday
  12: 1.3,  // December holiday peak
};

interface MonthlyRevenue {
  month: number; // 1-12
  year: number;
  revenue: number;
}

/**
 * Simple linear regression: y = mx + b
 * Returns slope (m) and intercept (b).
 */
function linearRegression(points: Array<{ x: number; y: number }>): { slope: number; intercept: number } {
  const n = points.length;
  if (n === 0) return { slope: 0, intercept: 0 };
  if (n === 1) return { slope: 0, intercept: points[0].y };

  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const p of points) {
    sumX += p.x;
    sumY += p.y;
    sumXY += p.x * p.y;
    sumXX += p.x * p.x;
  }

  const denominator = n * sumXX - sumX * sumX;
  if (denominator === 0) return { slope: 0, intercept: sumY / n };

  const slope = (n * sumXY - sumX * sumY) / denominator;
  const intercept = (sumY - slope * sumX) / n;

  return { slope, intercept };
}

export async function forecastAnnualRevenue(): Promise<{
  projectedAnnual: number;
  confidence: string;
  method: string;
  monthlyTrend: number[];
}> {
  const twelveMonthsAgo = new Date();
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const cutoff = twelveMonthsAgo.toISOString();

  // Query orders grouped by month for the last 12 months
  const monthlyData = await db
    .select({
      month: sql<number>`cast(strftime('%m', ${orders.orderedAt}) as integer)`,
      year: sql<number>`cast(strftime('%Y', ${orders.orderedAt}) as integer)`,
      revenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
    })
    .from(orders)
    .where(gte(orders.orderedAt, cutoff))
    .groupBy(
      sql`strftime('%Y', ${orders.orderedAt})`,
      sql`strftime('%m', ${orders.orderedAt})`,
    )
    .orderBy(
      sql`strftime('%Y', ${orders.orderedAt})`,
      sql`strftime('%m', ${orders.orderedAt})`,
    )
    .all();

  const monthsOfData = monthlyData.length;
  const now = new Date();
  const currentMonth = now.getMonth() + 1; // 1-12
  const currentYear = now.getFullYear();

  if (monthsOfData === 0) {
    return {
      projectedAnnual: 0,
      confidence: "low",
      method: "no_data",
      monthlyTrend: new Array(12).fill(0),
    };
  }

  if (monthsOfData < 3) {
    // Simple annualization: monthly average * 12
    const totalRevenue = monthlyData.reduce((sum, m) => sum + m.revenue, 0);
    const monthlyAvg = totalRevenue / monthsOfData;

    // Normalize by current seasonal factor, then project each month
    const currentFactor = SEASONAL_FACTORS[currentMonth] ?? 1.0;
    const baseMonthly = monthlyAvg / currentFactor;

    const monthlyTrend: number[] = [];
    let projectedAnnual = 0;

    for (let m = 1; m <= 12; m++) {
      const projected = Math.round(baseMonthly * (SEASONAL_FACTORS[m] ?? 1.0) * 100) / 100;
      monthlyTrend.push(projected);
      projectedAnnual += projected;
    }

    return {
      projectedAnnual: Math.round(projectedAnnual * 100) / 100,
      confidence: "low",
      method: "simple_annualization",
      monthlyTrend,
    };
  }

  // 3+ months: use linear regression on monthly revenue to project the trend
  // Normalize each month's revenue by its seasonal factor to get deseasonalized values
  const deseasonalized = monthlyData.map((m, i) => ({
    x: i,
    y: m.revenue / (SEASONAL_FACTORS[m.month] ?? 1.0),
  }));

  const { slope, intercept } = linearRegression(deseasonalized);

  // Project forward: for each of the 12 months of the current year,
  // calculate the trend value and re-apply seasonal factors
  const monthlyTrend: number[] = [];
  let projectedAnnual = 0;

  // Determine the index offset: the last data point index continues from our regression
  const lastIndex = deseasonalized.length - 1;

  // Calculate how many months from the last data point to January of the current year
  const lastDataMonth = monthlyData[monthlyData.length - 1];
  const monthsSinceLastData = (currentYear - lastDataMonth.year) * 12 + (1 - lastDataMonth.month);

  for (let m = 1; m <= 12; m++) {
    const futureIndex = lastIndex + monthsSinceLastData + (m - 1);
    const trendValue = slope * futureIndex + intercept;
    // Re-apply seasonal factor and ensure non-negative
    const projected = Math.max(0, Math.round(trendValue * (SEASONAL_FACTORS[m] ?? 1.0) * 100) / 100);
    monthlyTrend.push(projected);
    projectedAnnual += projected;
  }

  // Determine confidence based on data quantity and trend consistency
  let confidence: string;
  if (monthsOfData >= 9) {
    confidence = "high";
  } else if (monthsOfData >= 5) {
    confidence = "medium";
  } else {
    confidence = "low";
  }

  return {
    projectedAnnual: Math.round(projectedAnnual * 100) / 100,
    confidence,
    method: "linear_regression_seasonal",
    monthlyTrend,
  };
}
