import type { PipelineContext, StepResult } from "../context";
import { etsyListings, approvalQueueEntries } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";

const BATCH_SIZE = 5;

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped approval queue" };
  }

  // Get listings pending approval
  const listings = context.draftListingIds.length > 0
    ? await context.db.select().from(etsyListings).where(inArray(etsyListings.id, context.draftListingIds)).all()
    : await context.db.select().from(etsyListings).where(eq(etsyListings.status, "pending_approval")).all();

  if (listings.length === 0) {
    return { status: "completed", message: "No listings pending approval", data: { requiresApproval: false } };
  }

  // Get the next batch number
  const existingEntries = await context.db.select().from(approvalQueueEntries).all();
  const maxBatch = existingEntries.reduce((max, e) => Math.max(max, e.batchNumber ?? 0), 0);

  // Create batches of 5
  let currentBatch = maxBatch + 1;
  let batchOrder = 1;
  let queued = 0;

  for (const listing of listings) {
    // Check if already queued (idempotency)
    const existing = await context.db
      .select()
      .from(approvalQueueEntries)
      .where(eq(approvalQueueEntries.etsyListingId, listing.id))
      .get();
    if (existing) continue;

    await context.db.insert(approvalQueueEntries).values({
      etsyListingId: listing.id,
      batchNumber: currentBatch,
      batchOrder,
      mode: "manual",
      status: "pending",
    });

    queued++;
    batchOrder++;

    if (batchOrder > BATCH_SIZE) {
      currentBatch++;
      batchOrder = 1;
    }
  }

  const totalBatches = Math.ceil(queued / BATCH_SIZE);

  return {
    status: "completed",
    message: `Queued ${queued} listings in ${totalBatches} batches for approval`,
    data: {
      queued,
      batches: totalBatches,
      requiresApproval: queued > 0, // Signal to pipeline engine to pause
    },
  };
}
