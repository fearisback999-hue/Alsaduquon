import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { listings, orders } from "@/lib/db/schema";
import { eq, and } from "drizzle-orm";
import { getEnabledPlatforms } from "@/lib/platforms/registry";
import { UnsupportedPlatformOperation } from "@/lib/platforms/types";
import { estimateProfit } from "@/lib/etsy/pricing";
import { log } from "@/lib/logger";
import { verifyCronSecret } from "@/lib/auth/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  try {
    let synced = 0;
    let skipped = 0;
    const perPlatform: Record<string, number> = {};
    const platforms = getEnabledPlatforms();

    for (const platform of platforms) {
      try {
        const recentOrders = await platform.fetchRecentOrders(1);

        for (const order of recentOrders) {
          const listing = await db
            .select()
            .from(listings)
            .where(and(
              eq(listings.externalListingId, order.externalListingId),
              eq(listings.platform, platform.id),
            ))
            .get();

          if (!listing) {
            skipped++;
            continue;
          }

          const existingOrder = await db
            .select()
            .from(orders)
            .where(and(
              eq(orders.platform, platform.id),
              eq(orders.externalOrderId, order.externalOrderId),
            ))
            .get();

          if (existingOrder) {
            skipped++;
            continue;
          }

          // listing.basePrice is the stored LANDED cost (product + shipping under
          // a free-shipping model), so profit here already nets shipping — no
          // extra shipping term needed (passing one would double-count).
          const profitCalc = estimateProfit(order.revenue, listing.basePrice, order.quantity);

          await db.insert(orders).values({
            listingId: listing.id,
            externalOrderId: order.externalOrderId,
            platform: platform.id,
            status: order.status,
            quantity: order.quantity,
            revenue: profitCalc.revenue,
            cost: profitCalc.cost,
            profit: profitCalc.profit,
            customerRegion: order.customerRegion ?? null,
            orderedAt: order.orderedAt,
          });

          synced++;
          perPlatform[platform.id] = (perPlatform[platform.id] ?? 0) + 1;
        }
      } catch (err) {
        if (err instanceof UnsupportedPlatformOperation) {
          log("info", `Order sync skipped for ${platform.id} — not supported`);
        } else {
          log("error", `Order sync failed for ${platform.id}`, {
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }

    const platformSummary = Object.entries(perPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");
    log("info", `Order sync completed: ${synced} synced (${platformSummary}), ${skipped} skipped`);
    return NextResponse.json({ synced, skipped, perPlatform });
  } catch (error) {
    log("error", "Order sync failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json({ error: "Order sync failed" }, { status: 500 });
  }
}
