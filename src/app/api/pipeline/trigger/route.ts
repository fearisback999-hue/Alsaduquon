import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/engine";
import { acquireLock } from "@/lib/pipeline/concurrency";
import { z } from "zod";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const triggerSchema = z.object({
  startFromStep: z.number().int().min(1).max(10).optional(),
  dryRun: z.boolean().optional(),
}).optional().default({});

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => ({}));
  const parsed = triggerSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { startFromStep, dryRun } = parsed.data;

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
    const message = process.env.NODE_ENV === "production"
      ? "Pipeline execution failed"
      : error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
