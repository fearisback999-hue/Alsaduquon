import { NextRequest, NextResponse } from "next/server";
import { runPipeline } from "@/lib/pipeline/engine";
import { acquireLock, findResumableRun } from "@/lib/pipeline/concurrency";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { verifyCronSecret } from "@/lib/auth/cron-auth";
import { evaluateSeasonalUrgency } from "@/lib/pipeline/seasonal-trigger";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;

  // Respect autopilot toggle — when disabled, skip scheduled runs. Manual
  // triggers via /api/pipeline/trigger still work.
  const autopilotSetting = await db.select().from(settings).where(eq(settings.key, "autopilot_enabled")).get();
  if (autopilotSetting?.value === "false") {
    return NextResponse.json({ status: "skipped", reason: "Autopilot disabled" });
  }

  // Check if this is the second daily run (2 PM UTC) and if user wants it.
  // Seasonal urgency overrides the runs_per_day setting during high-value
  // prep windows (Christmas, Halloween, Mother's Day, etc.) — POD shops earn
  // 40-60% of annual revenue during seasonal spikes.
  const currentHour = new Date().getUTCHours();
  if (currentHour >= 12) {
    const seasonalDecision = evaluateSeasonalUrgency();
    if (!seasonalDecision.shouldRunExtra) {
      const runsSetting = await db.select().from(settings).where(eq(settings.key, "pipeline_runs_per_day")).get();
      const runsPerDay = parseInt(runsSetting?.value ?? "1") || 1;
      if (runsPerDay < 2) {
        return NextResponse.json({ status: "skipped", reason: "Second daily run disabled (pipeline_runs_per_day=1)" });
      }
    }
  }

  // Check for a paused run to resume (no lock needed — paused runs don't
  // hold the lock). If we find one, acquireLock will atomically flip it to
  // running; otherwise it creates a fresh run.
  const resumable = await findResumableRun();

  const lock = resumable
    ? await acquireLock({ resumeRunId: resumable.runId, startFromStep: resumable.resumeFromStep })
    : await acquireLock();

  if (!lock.acquired) {
    return NextResponse.json({ status: "skipped", reason: "Pipeline already running", runId: lock.existingRunId });
  }

  try {
    const result = resumable
      ? await runPipeline({ startFromStep: resumable.resumeFromStep, existingRunId: lock.runId })
      : await runPipeline({ existingRunId: lock.runId });

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
