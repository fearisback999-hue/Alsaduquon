import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/engine";
import { acquireLock, findResumableRun } from "@/lib/pipeline/concurrency";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 minutes (Vercel Pro)

export async function GET(request: NextRequest) {
  // Auth is handled by middleware (CRON_SECRET)

  // Respect autopilot toggle — when disabled, skip scheduled runs. Manual
  // triggers via /api/pipeline/trigger still work.
  const autopilotSetting = await db.select().from(settings).where(eq(settings.key, "autopilot_enabled")).get();
  if (autopilotSetting?.value === "false") {
    return NextResponse.json({ status: "skipped", reason: "Autopilot disabled" });
  }

  // Check if this is the second daily run (2 PM UTC) and if user wants it
  const currentHour = new Date().getUTCHours();
  if (currentHour >= 12) {
    // This is the afternoon run — check pipeline_runs_per_day setting
    const runsSetting = await db.select().from(settings).where(eq(settings.key, "pipeline_runs_per_day")).get();
    const runsPerDay = parseInt(runsSetting?.value ?? "1") || 1;
    if (runsPerDay < 2) {
      return NextResponse.json({ status: "skipped", reason: "Second daily run disabled (pipeline_runs_per_day=1)" });
    }
  }

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
    const message = process.env.NODE_ENV === "production"
      ? "Internal server error"
      : error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { status: "error", message },
      { status: 500 },
    );
  }
}
