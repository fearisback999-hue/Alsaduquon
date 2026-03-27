import type { PipelineContext, StepResult } from "../context";
import { etsyListings, approvalQueueEntries, printifyProducts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as etsy from "@/lib/external/etsy";
import * as printify from "@/lib/external/printify";
import { enforceListingLimit, incrementListingCount, checkListingLimit } from "@/lib/cost/guard";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped publishing" };
  }

  // Get approved entries
  const approvedEntries = await context.db
    .select()
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.status, "approved"))
    .all();

  if (approvedEntries.length === 0) {
    return { status: "completed", message: "No approved listings to publish" };
  }

  let published = 0;
  let failed = 0;
  let skippedLimit = 0;

  for (const entry of approvedEntries) {
    // Check daily listing limit
    try {
      await enforceListingLimit();
    } catch {
      skippedLimit++;
      continue;
    }

    const listing = await context.db
      .select()
      .from(etsyListings)
      .where(eq(etsyListings.id, entry.etsyListingId))
      .get();

    if (!listing || !listing.etsyListingId) {
      failed++;
      continue;
    }

    try {
      // Publish on Etsy (draft -> active)
      await etsy.publishListing(Number(listing.etsyListingId));

      // Also publish on Printify
      const product = await context.db
        .select()
        .from(printifyProducts)
        .where(eq(printifyProducts.id, listing.printifyProductId))
        .get();

      if (product?.printifyProductId && product?.printifyShopId) {
        await printify.publishProduct(product.printifyShopId, product.printifyProductId);
        await context.db.update(printifyProducts).set({ status: "published" }).where(eq(printifyProducts.id, product.id));
      }

      // Update listing status
      await context.db.update(etsyListings).set({
        status: "published",
        etsyState: "active",
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(etsyListings.id, listing.id));

      // Update approval entry
      await context.db.update(approvalQueueEntries).set({
        updatedAt: new Date().toISOString(),
      }).where(eq(approvalQueueEntries.id, entry.id));

      // Increment daily listing count
      await incrementListingCount();

      published++;
      context.approvedListingIds.push(listing.id);
    } catch (error) {
      failed++;
    }
  }

  return {
    status: "completed",
    message: `Published ${published} listings, ${failed} failed, ${skippedLimit} skipped (daily limit)`,
    data: { published, failed, skippedLimit },
  };
}
