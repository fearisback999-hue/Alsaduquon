import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalQueueEntries, etsyListings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { runPipeline } from "@/lib/pipeline/engine";
import { findResumableRun } from "@/lib/pipeline/concurrency";
import { z } from "zod";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

const approvalItemSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approved", "rejected"]),
  feedback: z.string().max(500).optional(),
});

const batchApprovalSchema = z.object({
  approvals: z.array(approvalItemSchema).min(1).max(50),
});

export async function POST(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = batchApprovalSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { approvals } = parsed.data;
  let approved = 0;
  let rejected = 0;

  for (const item of approvals) {
    const { id, action, feedback } = item;

    await db.update(approvalQueueEntries).set({
      status: action,
      feedback: feedback ?? null,
      reviewedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }).where(eq(approvalQueueEntries.id, id));

    // Update corresponding listing status
    const entry = await db.select().from(approvalQueueEntries).where(eq(approvalQueueEntries.id, id)).get();
    if (entry) {
      await db.update(etsyListings).set({
        status: action === "approved" ? "approved" : "rejected",
        updatedAt: new Date().toISOString(),
      }).where(eq(etsyListings.id, entry.etsyListingId));
    }

    if (action === "approved") approved++;
    else rejected++;
  }

  // If there are approved listings, try to resume the pipeline at step 10 (publish)
  let publishResult = null;
  if (approved > 0) {
    const resumable = await findResumableRun();
    if (resumable && resumable.resumeFromStep === 10) {
      try {
        publishResult = await runPipeline({
          startFromStep: 10,
          existingRunId: resumable.runId,
        });
      } catch {
        // Publish can be triggered separately
      }
    }
  }

  return NextResponse.json({
    approved,
    rejected,
    publishResult,
  });
}
