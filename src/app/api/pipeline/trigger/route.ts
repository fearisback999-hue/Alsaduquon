import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/engine";
import { acquireLock } from "@/lib/pipeline/concurrency";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const { startFromStep, dryRun } = body;

  const lock = await acquireLock();
  if (!lock.acquired) {
    return NextResponse.json(
      { error: "Pipeline already running", runId: lock.existingRunId },
      { status: 409 },
    );
  }

  try {
    const result = await runPipeline({ startFromStep, dryRun });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 },
    );
  }
}
