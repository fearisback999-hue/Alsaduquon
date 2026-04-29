import type { PipelineContext, StepResult } from "../context";
import { listings, approvalQueueEntries, printifyProducts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { getPlatform } from "@/lib/platforms/registry";
import { enforceListingLimit, incrementListingCount } from "@/lib/cost/guard";
import { log } from "@/lib/logger";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped publishing" };
  }

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
  let skippedPlatform = 0;
  const perPlatform: Record<string, number> = {};

  for (const entry of approvedEntries) {
    try {
      await enforceListingLimit();
    } catch {
      skippedLimit++;
      continue;
    }

    const listing = await context.db
      .select()
      .from(listings)
      .where(eq(listings.id, entry.listingId))
      .get();

    if (!listing || !listing.externalListingId) {
      failed++;
      continue;
    }

    const platform = getPlatform(listing.platform as Parameters<typeof getPlatform>[0]);
    if (!platform) {
      log("warn", `[Step 10] Platform "${listing.platform}" not configured, skipping listing ${listing.id}`);
      skippedPlatform++;
      continue;
    }

    try {
      await platform.publishListing(listing.externalListingId);

      // For Printify-backed platforms, also publish on Printify
      if (listing.printifyProductId && listing.platform !== "redbubble") {
        const product = await context.db
          .select()
          .from(printifyProducts)
          .where(eq(printifyProducts.id, listing.printifyProductId))
          .get();

        if (product?.printifyProductId && product?.printifyShopId) {
          await printify.publishProduct(product.printifyShopId, product.printifyProductId);
          await context.db.update(printifyProducts).set({ status: "published" }).where(eq(printifyProducts.id, product.id));
        }
      }

      await context.db.update(listings).set({
        status: "published",
        externalState: "active",
        publishedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }).where(eq(listings.id, listing.id));

      await context.db.update(approvalQueueEntries).set({
        status: "published",
        updatedAt: new Date().toISOString(),
      }).where(eq(approvalQueueEntries.id, entry.id));

      await incrementListingCount();

      published++;
      perPlatform[listing.platform] = (perPlatform[listing.platform] ?? 0) + 1;
      context.approvedListingIds.push(listing.id);
    } catch (error) {
      log("error", `[Step 10] Publish failed for listing ${listing.id} on ${listing.platform}`, {
        externalListingId: listing.externalListingId,
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
    }
  }

  const platformSummary = Object.entries(perPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");

  return {
    status: "completed",
    message: `Published ${published} listings (${platformSummary}), ${failed} failed, ${skippedLimit} skipped (daily limit), ${skippedPlatform} skipped (unconfigured platform)`,
    data: { published, failed, skippedLimit, skippedPlatform, perPlatform },
  };
}
