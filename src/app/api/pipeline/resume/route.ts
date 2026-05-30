import { NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/engine";
import { acquireLock, findResumableRun } from "@/lib/pipeline/concurrency";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const resumable = await findResumableRun();
  if (!resumable) {
    return NextResponse.json(
      { error: "No paused run to resume" },
      { status: 404 },
    );
  }

  const lock = await acquireLock({
    resumeRunId: resumable.runId,
    startFromStep: resumable.resumeFromStep,
  });

  if (!lock.acquired) {
    return NextResponse.json(
      { error: "Pipeline already running", runId: lock.existingRunId },
      { status: 409 },
    );
  }

  try {
    const result = await runPipeline({
      startFromStep: resumable.resumeFromStep,
      existingRunId: lock.runId,
    });
    return NextResponse.json(result);
  } catch (error) {
    const message = process.env.NODE_ENV === "production"
      ? "Pipeline execution failed"
      : error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
