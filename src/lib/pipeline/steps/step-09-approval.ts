import type { PipelineContext, StepResult } from "../context";
import { listings, approvalQueueEntries } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { evaluateForAutoApproval } from "@/lib/pipeline/auto-approve";
import { log } from "@/lib/logger";

const BATCH_SIZE = 5;

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped approval queue" };
  }

  const pendingListings = context.draftListingIds.length > 0
    ? await context.db.select().from(listings).where(inArray(listings.id, context.draftListingIds)).all()
    : await context.db.select().from(listings).where(eq(listings.status, "pending_approval")).all();

  if (pendingListings.length === 0) {
    return { status: "completed", message: "No listings pending approval", data: { requiresApproval: false } };
  }

  let autoApproved = 0;
  let queued = 0;

  const existingEntries = await context.db.select().from(approvalQueueEntries).all();
  const maxBatch = existingEntries.reduce((max, e) => Math.max(max, e.batchNumber ?? 0), 0);
  let currentBatch = maxBatch + 1;
  let batchOrder = 1;

  for (const listing of pendingListings) {
    const existing = await context.db
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.listingId, listing.id))
      .get();
    if (existing) continue;

    const autoResult = await evaluateForAutoApproval(listing.id);

    if (autoResult.approved) {
      await context.db.insert(approvalQueueEntries).values({
        listingId: listing.id,
        batchNumber: currentBatch,
        batchOrder,
        mode: "auto",
        status: "approved",
        autoScore: autoResult.confidence,
        feedback: `Auto-approved: ${autoResult.reasons.join(", ")}`,
        reviewedAt: new Date().toISOString(),
      });

      await context.db
        .update(listings)
        .set({ status: "approved", updatedAt: new Date().toISOString() })
        .where(eq(listings.id, listing.id));

      context.approvedListingIds.push(listing.id);
      autoApproved++;
      log("info", `[Step 09] Auto-approved: "${listing.title}" [${listing.platform}] (confidence: ${(autoResult.confidence * 100).toFixed(0)}%)`);
    } else {
      await context.db.insert(approvalQueueEntries).values({
        listingId: listing.id,
        batchNumber: currentBatch,
        batchOrder,
        mode: "manual",
        status: "pending",
        autoScore: autoResult.confidence,
        feedback: `Below auto-approval threshold (${(autoResult.confidence * 100).toFixed(0)}%): ${autoResult.reasons.join(", ")}`,
      });

      queued++;
    }

    batchOrder++;
    if (batchOrder > BATCH_SIZE) {
      currentBatch++;
      batchOrder = 1;
    }
  }

  const totalBatches = Math.ceil(queued / BATCH_SIZE);
  const requiresApproval = queued > 0;

  return {
    status: "completed",
    message: `${autoApproved} auto-approved, ${queued} queued for manual review (${totalBatches} batches)`,
    data: { autoApproved, queued, batches: totalBatches, requiresApproval },
  };
}
