import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { etsyListings, orders } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as etsy from "@/lib/external/etsy";
import { estimateProfit } from "@/lib/etsy/pricing";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

export async function GET() {
  // Auth is handled by middleware (CRON_SECRET)

  try {
    // Fetch recent receipts from Etsy (last 24 hours)
    const oneDayAgo = Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000);
    const receipts = await etsy.getShopReceipts({ minCreated: oneDayAgo, limit: 100 });

    let synced = 0;
    let skipped = 0;

    for (const receipt of receipts.results) {
      for (const transaction of receipt.transactions) {
        const etsyListingId = String(transaction.listing_id);

        // Find our listing record
        const listing = await db
          .select()
          .from(etsyListings)
          .where(eq(etsyListings.etsyListingId, etsyListingId))
          .get();

        if (!listing) {
          skipped++;
          continue;
        }

        // Check if order already exists (idempotency)
        const existingOrder = await db
          .select()
          .from(orders)
          .where(eq(orders.etsyOrderId, String(receipt.receipt_id)))
          .get();

        if (existingOrder) {
          skipped++;
          continue;
        }

        const revenue = transaction.price.amount / transaction.price.divisor;
        const profitCalc = estimateProfit(revenue, listing.basePrice, transaction.quantity);

        await db.insert(orders).values({
          etsyListingId: listing.id,
          etsyOrderId: String(receipt.receipt_id),
          status: receipt.status === "paid" ? "processing" : receipt.status as any,
          quantity: transaction.quantity,
          revenue: profitCalc.revenue,
          cost: profitCalc.printifyCost,
          profit: profitCalc.profit,
          orderedAt: new Date().toISOString(),
        });

        synced++;
      }
    }

    log("info", `Order sync completed: ${synced} synced, ${skipped} skipped`);
    return NextResponse.json({ synced, skipped, total: receipts.count });
  } catch (error) {
    log("error", "Order sync failed", { error: error instanceof Error ? error.message : String(error) });
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
