import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStepLogs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  // Get the latest pipeline run
  const latestRun = await db
    .select()
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(1)
    .get();

  if (!latestRun) {
    return NextResponse.json({ run: null, logs: [] });
  }

  // Get step logs for this run
  const logs = await db
    .select()
    .from(pipelineStepLogs)
    .where(eq(pipelineStepLogs.pipelineRunId, latestRun.id))
    .orderBy(pipelineStepLogs.stepNumber)
    .all();

  // Get recent runs
  const recentRuns = await db
    .select()
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(10)
    .all();

  return NextResponse.json({ run: latestRun, logs, recentRuns });
}
