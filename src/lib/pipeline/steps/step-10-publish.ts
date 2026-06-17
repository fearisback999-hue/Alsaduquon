import type { PipelineContext, StepResult } from "../context";
import { listings, approvalQueueEntries, printifyProducts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { getPlatform } from "@/lib/platforms/registry";
import { enforceListingLimit, incrementListingCount } from "@/lib/cost/guard";
import { ListingLimitError } from "@/lib/errors";
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
  const errorSamples: string[] = [];
  const recordError = (msg: string) => { if (errorSamples.length < 5) errorSamples.push(msg); };

  for (const entry of approvedEntries) {
    try {
      await enforceListingLimit();
    } catch (error) {
      // ONLY treat the daily-limit error as a skip. Any other error (e.g. a DB
      // failure inside getOrCreateDailyCost) must NOT be silently swallowed as
      // a benign limit-skip — rethrow so the engine fails the step.
      if (error instanceof ListingLimitError) {
        skippedLimit++;
        continue;
      }
      throw error;
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

      const PRINTIFY_PLATFORMS = new Set(["etsy", "shopify", "tiktok", "amazon"]);
      if (listing.printifyProductId && PRINTIFY_PLATFORMS.has(listing.platform)) {
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
      const msg = error instanceof Error ? error.message : String(error);
      log("error", `[Step 10] Publish failed for listing ${listing.id} on ${listing.platform}: ${msg}`, {
        externalListingId: listing.externalListingId,
        error: msg,
      });
      recordError(`listing ${listing.id} (${listing.platform}): ${msg}`);
      failed++;
    }
  }

  const platformSummary = Object.entries(perPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");
  const errorSuffix = errorSamples.length > 0 ? ` — ERRORS: ${errorSamples.join("; ")}` : "";

  // We had approved listings but published none. Whether the cause was publish
  // failures, an exhausted daily limit, or an unconfigured platform, this is NOT
  // a success — fail loudly so approved inventory doesn't silently never ship.
  if (published === 0 && approvedEntries.length > 0) {
    const reason = skippedPlatform > 0 && failed === 0 && skippedLimit === 0
      ? `target platform not configured (${skippedPlatform} listings skipped)`
      : skippedLimit > 0 && failed === 0 && skippedPlatform === 0
        ? `daily listing limit reached (${skippedLimit} skipped) — raise max_daily_listings or wait until tomorrow`
        : `${failed} failed, ${skippedLimit} skipped (limit), ${skippedPlatform} skipped (unconfigured platform)`;
    return {
      status: "failed",
      message: `Published 0 of ${approvedEntries.length} approved listings — ${reason}${errorSuffix}`,
      data: { published, failed, skippedLimit, skippedPlatform, perPlatform, errors: errorSamples },
    };
  }

  return {
    status: "completed",
    message: `Published ${published} listings (${platformSummary}), ${failed} failed, ${skippedLimit} skipped (daily limit), ${skippedPlatform} skipped (unconfigured platform)${errorSuffix}`,
    data: { published, failed, skippedLimit, skippedPlatform, perPlatform, errors: errorSamples },
  };
}
