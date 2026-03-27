import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/engine";
import { acquireLock, findResumableRun } from "@/lib/pipeline/concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes (Vercel Pro)

export async function GET(request: NextRequest) {
  // Auth is handled by middleware (CRON_SECRET)

  // Check for concurrent runs
  const lock = await acquireLock();
  if (!lock.acquired) {
    return NextResponse.json({ status: "skipped", reason: "Pipeline already running", runId: lock.existingRunId });
  }

  // Check for a paused run to resume
  const resumable = await findResumableRun();

  try {
    const result = resumable
      ? await runPipeline({ startFromStep: resumable.resumeFromStep, existingRunId: resumable.runId })
      : await runPipeline();

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { status: "error", message: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
