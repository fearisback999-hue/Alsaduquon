import { db } from "@/lib/db";
import { pipelineRuns, pipelineStepLogs } from "@/lib/db/schema";
import { eq, and, or, desc } from "drizzle-orm";
import { STEP_NAMES } from "@/lib/types";

const STALE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes without any step activity

interface AcquireLockOptions {
  /** If set, flip this paused run to 'running' instead of creating a new row. */
  resumeRunId?: string;
  /** If set, use this step number as the starting step for the new run. */
  startFromStep?: number;
}

/**
 * Atomically acquire the pipeline lock inside a transaction. Ensures at most
 * one run is in 'running' state.
 *
 * - Fresh run: creates a new pipelineRuns row with status='running'.
 * - Resume: flips the specified paused run to 'running' atomically.
 *
 * Returns the new/resumed runId so callers can pass it to runPipeline()
 * as existingRunId — avoids creating a duplicate row.
 *
 * Staleness is determined by the latest pipelineStepLogs entry for a run,
 * not the startedAt timestamp. A long-running pipeline that's actively
 * processing steps stays alive; only genuinely stuck runs get reclaimed.
 */
export async function acquireLock(options?: AcquireLockOptions): Promise<{ acquired: boolean; runId?: string; existingRunId?: string }> {
  return await db.transaction(async (tx) => {
    const activeRuns = await tx
      .select()
      .from(pipelineRuns)
      .where(or(eq(pipelineRuns.status, "running"), eq(pipelineRuns.status, "pending")))
      .all();

    for (const run of activeRuns) {
      const latestLog = await tx
        .select({ createdAt: pipelineStepLogs.createdAt })
        .from(pipelineStepLogs)
        .where(eq(pipelineStepLogs.pipelineRunId, run.id))
        .orderBy(desc(pipelineStepLogs.createdAt))
        .limit(1)
        .get();

      const lastActivityIso = latestLog?.createdAt ?? run.startedAt ?? run.createdAt;
      const lastActivity = new Date(lastActivityIso).getTime();
      const elapsed = Date.now() - lastActivity;

      if (elapsed > STALE_TIMEOUT_MS) {
        await tx.update(pipelineRuns).set({
          status: "failed",
          error: "Pipeline timed out (no step activity for 30 min)",
          completedAt: new Date().toISOString(),
        }).where(eq(pipelineRuns.id, run.id));
        continue;
      }

      return { acquired: false, existingRunId: run.id };
    }

    if (options?.resumeRunId) {
      const startStep = options.startFromStep ?? 1;
      // Only flip to running if still paused — guards against a concurrent
      // resume that beat us to it.
      const updateResult = await tx.update(pipelineRuns).set({
        status: "running",
        currentStep: startStep,
        currentStepName: STEP_NAMES[startStep - 1],
        startedAt: new Date().toISOString(),
      }).where(and(eq(pipelineRuns.id, options.resumeRunId), eq(pipelineRuns.status, "paused"))).run();

      if (Number(updateResult.rowsAffected ?? 0) === 0) {
        return { acquired: false, existingRunId: options.resumeRunId };
      }
      return { acquired: true, runId: options.resumeRunId };
    }

    const startStep = options?.startFromStep ?? 1;
    const [run] = await tx.insert(pipelineRuns).values({
      status: "running",
      currentStep: startStep,
      currentStepName: STEP_NAMES[startStep - 1],
      startedAt: new Date().toISOString(),
    }).returning();

    return { acquired: true, runId: run.id };
  });
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
