import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { pipelineRuns, pipelineStepLogs } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const runsLimit = Math.min(Math.max(parseInt(searchParams.get("runs") ?? "10") || 10, 1), 100);

  const latestRun = await db
    .select()
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(1)
    .get();

  if (!latestRun) {
    return NextResponse.json({ run: null, logs: [], recentRuns: [] });
  }

  const logs = await db
    .select()
    .from(pipelineStepLogs)
    .where(eq(pipelineStepLogs.pipelineRunId, latestRun.id))
    .orderBy(pipelineStepLogs.stepNumber)
    .all();

  const recentRuns = await db
    .select()
    .from(pipelineRuns)
    .orderBy(desc(pipelineRuns.createdAt))
    .limit(runsLimit)
    .all();

  return NextResponse.json({ run: latestRun, logs, recentRuns });
}
