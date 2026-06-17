import { db } from "@/lib/db";
import { orders, settings } from "@/lib/db/schema";
import { sql, gte, and, eq, inArray } from "drizzle-orm";
import { log } from "@/lib/logger";

/**
 * Check for signs of payment/order health problems:
 * 1. 3+ consecutive cancelled/refunded orders in the last 7 days
 * 2. Refund ratio exceeding 20% over the last 30 days
 */
export async function checkPaymentHealth(): Promise<{ healthy: boolean; reason?: string }> {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Check 1: Look for 3+ consecutive cancelled/refunded orders in last 7 days
  const recentOrders = await db
    .select({
      id: orders.id,
      status: orders.status,
      orderedAt: orders.orderedAt,
    })
    .from(orders)
    .where(gte(orders.createdAt, sevenDaysAgo))
    .orderBy(sql`${orders.createdAt} DESC`)
    .all();

  if (recentOrders.length >= 3) {
    let consecutiveBad = 0;
    for (const order of recentOrders) {
      if (order.status === "cancelled" || order.status === "refunded") {
        consecutiveBad++;
        if (consecutiveBad >= 3) {
          return {
            healthy: false,
            reason: `${consecutiveBad} consecutive cancelled/refunded orders detected in the last 7 days`,
          };
        }
      } else {
        consecutiveBad = 0;
      }
    }
  }

  // Check 2: Refund ratio over 30 days
  const thirtyDayStats = await db
    .select({
      totalOrders: sql<number>`count(*)`,
      refundedOrders: sql<number>`sum(case when ${orders.status} = 'refunded' then 1 else 0 end)`,
    })
    .from(orders)
    .where(gte(orders.createdAt, thirtyDaysAgo))
    .get();

  const total = thirtyDayStats?.totalOrders ?? 0;
  const refunded = thirtyDayStats?.refundedOrders ?? 0;

  if (total > 0 && refunded / total > 0.2) {
    return {
      healthy: false,
      reason: `Refund ratio ${Math.round((refunded / total) * 100)}% exceeds 20% threshold (${refunded}/${total} orders in last 30 days)`,
    };
  }

  return { healthy: true };
}

/**
 * Auto-pause the pipeline if payment health checks fail.
 * Sets `pipeline_auto_paused` = "true" in the settings table with a description.
 */
export async function autoPausePipeline(): Promise<{ paused: boolean; reason?: string }> {
  const health = await checkPaymentHealth();

  if (health.healthy) {
    return { paused: false };
  }

  const reason = health.reason ?? "Unknown payment health issue";
  log("warn", `Auto-pausing pipeline due to payment health issue: ${reason}`);

  // Upsert the pipeline_auto_paused setting
  const existing = await db
    .select()
    .from(settings)
    .where(eq(settings.key, "pipeline_auto_paused"))
    .get();

  const settingData = {
    value: "true",
    type: "boolean" as const,
    group: "pipeline" as const,
    description: `Auto-paused: ${reason} (${new Date().toISOString()})`,
    updatedAt: new Date().toISOString(),
  };

  if (existing) {
    await db.update(settings).set(settingData).where(eq(settings.id, existing.id));
  } else {
    await db.insert(settings).values({
      key: "pipeline_auto_paused",
      ...settingData,
    });
  }

  log("warn", "Pipeline auto-paused due to payment issues", { reason });
  return { paused: true, reason };
}
