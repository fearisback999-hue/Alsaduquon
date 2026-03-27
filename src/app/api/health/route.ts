import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings, pipelineRuns } from "@/lib/db/schema";
import { desc } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const checks: Record<string, { status: string; detail?: string }> = {};

  // Database connectivity
  try {
    await db.select().from(settings).limit(1).get();
    checks.database = { status: "ok" };
  } catch (error) {
    checks.database = { status: "error", detail: error instanceof Error ? error.message : "Unknown" };
  }

  // Last pipeline run
  try {
    const lastRun = await db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(1).get();
    if (lastRun) {
      const ageMs = Date.now() - new Date(lastRun.createdAt).getTime();
      const ageHours = Math.round(ageMs / 3600000);
      checks.lastPipeline = { status: ageHours > 48 ? "warning" : "ok", detail: `${ageHours}h ago, status: ${lastRun.status}` };
    } else {
      checks.lastPipeline = { status: "warning", detail: "No pipeline runs yet" };
    }
  } catch {
    checks.lastPipeline = { status: "error" };
  }

  // API keys configured
  checks.openai = { status: process.env.OPENAI_API_KEY ? "ok" : "missing" };
  checks.printify = { status: process.env.PRINTIFY_API_TOKEN ? "ok" : "missing" };
  checks.etsy = { status: process.env.ETSY_CLIENT_ID ? "ok" : "missing" };

  const allOk = Object.values(checks).every((c) => c.status === "ok");

  return NextResponse.json({ status: allOk ? "healthy" : "degraded", checks }, { status: allOk ? 200 : 503 });
}
