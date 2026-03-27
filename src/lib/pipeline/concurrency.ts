import { db } from "@/lib/db";
import { pipelineRuns } from "@/lib/db/schema";
import { eq, and, or } from "drizzle-orm";

const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

/**
 * Check if a pipeline is already running. Returns the run ID if so.
 * Also detects stale runs (running but no progress for 30 min) and marks them failed.
 */
export async function acquireLock(): Promise<{ acquired: boolean; existingRunId?: string }> {
  const activeRuns = await db
    .select()
    .from(pipelineRuns)
    .where(or(eq(pipelineRuns.status, "running"), eq(pipelineRuns.status, "pending")))
    .all();

  for (const run of activeRuns) {
    const startTime = run.startedAt ? new Date(run.startedAt).getTime() : new Date(run.createdAt).getTime();
    const elapsed = Date.now() - startTime;

    if (elapsed > STALE_TIMEOUT_MS) {
      // Mark stale run as failed
      await db.update(pipelineRuns).set({
        status: "failed",
        error: "Pipeline timed out (stale lock detected)",
        completedAt: new Date().toISOString(),
      }).where(eq(pipelineRuns.id, run.id));
      continue;
    }

    // A legit run is active
    return { acquired: false, existingRunId: run.id };
  }

  return { acquired: true };
}

/**
 * Find a paused pipeline run that can be resumed.
 */
export async function findResumableRun(): Promise<{ runId: string; resumeFromStep: number } | null> {
  const pausedRun = await db
    .select()
    .from(pipelineRuns)
    .where(eq(pipelineRuns.status, "paused"))
    .orderBy(pipelineRuns.createdAt)
    .limit(1)
    .get();

  if (!pausedRun) return null;

  return {
    runId: pausedRun.id,
    resumeFromStep: pausedRun.currentStep,
  };
}
