import { db } from "@/lib/db";
import { pipelineRuns } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { createEmptyContext } from "./context";
import { getStep, TOTAL_STEPS } from "./registry";
import { createStepLogger, log } from "@/lib/logger";
import { checkBudget } from "@/lib/cost/guard";
import { BudgetExceededError, PipelineStepError } from "@/lib/errors";
import { STEP_NAMES } from "@/lib/types";

interface RunOptions {
  startFromStep?: number;
  dryRun?: boolean;
  existingRunId?: string;
}

export async function runPipeline(options?: RunOptions): Promise<{ runId: string; status: string; completedSteps: number }> {
  const startStep = options?.startFromStep ?? 1;
  const dryRun = options?.dryRun ?? false;

  // Create or resume a pipeline run
  let runId: string;
  if (options?.existingRunId) {
    runId = options.existingRunId;
    await db.update(pipelineRuns).set({
      status: "running",
      currentStep: startStep,
      currentStepName: STEP_NAMES[startStep - 1],
      startedAt: new Date().toISOString(),
    }).where(eq(pipelineRuns.id, runId));
  } else {
    const [run] = await db.insert(pipelineRuns).values({
      status: "running",
      currentStep: startStep,
      currentStepName: STEP_NAMES[startStep - 1],
      startedAt: new Date().toISOString(),
    }).returning();
    runId = run.id;
  }

  log("info", `Pipeline ${dryRun ? "(DRY RUN) " : ""}started`, { runId, startStep });

  const context = createEmptyContext(runId, db, dryRun);
  let completedSteps = 0;
  let totalCost = 0;

  for (let stepNum = startStep; stepNum <= TOTAL_STEPS; stepNum++) {
    const stepName = STEP_NAMES[stepNum - 1];
    const logger = createStepLogger(runId, stepNum, stepName);

    // Check budget before each step
    try {
      const budget = await checkBudget();
      if (budget.remaining <= 0) {
        throw new BudgetExceededError(budget.used, budget.max);
      }
    } catch (error) {
      if (error instanceof BudgetExceededError) {
        log("warn", "Pipeline paused: daily budget exceeded", { runId, step: stepNum });
        await db.update(pipelineRuns).set({
          status: "paused",
          currentStep: stepNum,
          currentStepName: stepName,
          error: error.message,
        }).where(eq(pipelineRuns.id, runId));
        return { runId, status: "paused", completedSteps };
      }
      throw error;
    }

    // Update current step
    await db.update(pipelineRuns).set({
      currentStep: stepNum,
      currentStepName: stepName,
    }).where(eq(pipelineRuns.id, runId));

    // Execute step
    try {
      await logger.recordStart();
      const step = await getStep(stepNum);

      log("info", `Running step ${stepNum}: ${stepName}`, { runId });
      const result = await step.execute(context);

      if (result.cost) totalCost += result.cost;

      if (result.status === "completed") {
        await logger.recordComplete(result.message, result.cost);
        completedSteps++;
      } else if (result.status === "skipped") {
        await logger.recordSkipped(result.message);
        completedSteps++;
      } else {
        await logger.recordFailed(result.message ?? "Unknown failure");
        throw new PipelineStepError(result.message ?? "Step failed", stepNum, stepName);
      }

      // Step 9 (approval) pauses the pipeline for human review
      if (stepNum === 9 && result.data?.requiresApproval) {
        log("info", "Pipeline paused for approval", { runId });
        await db.update(pipelineRuns).set({
          status: "paused",
          currentStep: 10, // Next step to resume at
          currentStepName: "publish",
          totalCost,
        }).where(eq(pipelineRuns.id, runId));
        return { runId, status: "paused", completedSteps };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await logger.recordFailed(message);

      log("error", `Pipeline failed at step ${stepNum}: ${stepName}`, { runId, error: message });

      await db.update(pipelineRuns).set({
        status: "failed",
        currentStep: stepNum,
        currentStepName: stepName,
        error: message,
        totalCost,
      }).where(eq(pipelineRuns.id, runId));

      return { runId, status: "failed", completedSteps };
    }
  }

  // Pipeline completed successfully
  await db.update(pipelineRuns).set({
    status: "completed",
    currentStep: TOTAL_STEPS,
    currentStepName: STEP_NAMES[TOTAL_STEPS - 1],
    completedAt: new Date().toISOString(),
    totalCost,
  }).where(eq(pipelineRuns.id, runId));

  log("info", "Pipeline completed", { runId, completedSteps, totalCost });
  return { runId, status: "completed", completedSteps };
}
