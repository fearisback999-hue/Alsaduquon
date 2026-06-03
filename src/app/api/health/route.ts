import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings, pipelineRuns, listings, dailyCosts } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";
import { validateEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

type CheckStatus = "ok" | "warning" | "error" | "configured" | "missing";

function envCheck(...vars: string[]): { status: CheckStatus; detail?: string } {
  const missing = vars.filter((v) => !process.env[v]);
  if (missing.length === 0) return { status: "configured" };
  return { status: "missing", detail: `missing: ${missing.join(", ")}` };
}

export async function GET() {
  const checks: Record<string, { status: CheckStatus; detail?: string }> = {};
  const startedAt = Date.now();

  // Database connectivity
  try {
    await db.select().from(settings).limit(1).get();
    checks.database = { status: "ok", detail: `${Date.now() - startedAt}ms` };
  } catch (e) {
    checks.database = { status: "error", detail: e instanceof Error ? e.message : "query failed" };
  }

  // Last pipeline run — detect both staleness and stuck (running/paused too long)
  try {
    const lastRun = await db.select().from(pipelineRuns).orderBy(desc(pipelineRuns.createdAt)).limit(1).get();
    if (lastRun) {
      const ageMs = Date.now() - new Date(lastRun.createdAt).getTime();
      const ageHours = Math.round(ageMs / 3600000);
      // A run that's been "running" for >2h is almost certainly stuck (a real
      // pipeline run is minutes). "paused" is expected (awaiting approval).
      const stuck = lastRun.status === "running" && ageHours >= 2;
      const stale = ageHours > 48;
      checks.lastPipeline = {
        status: stuck ? "error" : stale ? "warning" : "ok",
        detail: `${ageHours}h ago, status: ${lastRun.status}${stuck ? " (STUCK — running >2h)" : ""}`,
      };
    } else {
      checks.lastPipeline = { status: "warning", detail: "No pipeline runs yet" };
    }
  } catch {
    checks.lastPipeline = { status: "error" };
  }

  // Budget headroom — surfaces a pipeline that's silently paused on budget
  try {
    const date = new Date().toISOString().split("T")[0];
    const daily = await db.select().from(dailyCosts).where(eq(dailyCosts.date, date)).get();
    if (daily) {
      const remaining = daily.maxDailyCost - daily.totalCost;
      const pctUsed = daily.maxDailyCost > 0 ? (daily.totalCost / daily.maxDailyCost) * 100 : 0;
      checks.budget = {
        status: remaining <= 0 ? "error" : pctUsed >= 90 ? "warning" : "ok",
        detail: `$${daily.totalCost.toFixed(2)}/$${daily.maxDailyCost.toFixed(2)} (${pctUsed.toFixed(0)}%), ${daily.listingsCreated}/${daily.maxDailyListings} listings`,
      };
    } else {
      checks.budget = { status: "ok", detail: "no spend today" };
    }
  } catch {
    checks.budget = { status: "error" };
  }

  // Pending-approval backlog — an unattended queue means listings aren't shipping
  try {
    const pending = await db.select({ id: listings.id }).from(listings).where(eq(listings.status, "pending_approval")).all();
    checks.approvalQueue = {
      status: pending.length > 50 ? "warning" : "ok",
      detail: `${pending.length} listing(s) awaiting approval`,
    };
  } catch {
    checks.approvalQueue = { status: "error" };
  }

  // Env validation — production requires full integration keys, dev only core
  const envResult = validateEnv();
  checks.env = envResult.valid
    ? { status: "ok" }
    : { status: "error", detail: `missing: ${envResult.missing.join(", ")}` };

  // Per-service detail for quick triage
  checks.openai = envCheck("OPENAI_API_KEY");
  checks.printify = envCheck("PRINTIFY_API_TOKEN", "PRINTIFY_SHOP_ID");
  checks.etsy = envCheck("ETSY_CLIENT_ID", "ETSY_CLIENT_SECRET", "ETSY_REFRESH_TOKEN");
  checks.blobStorage = envCheck("BLOB_READ_WRITE_TOKEN");

  const hasError = Object.values(checks).some((c) => c.status === "error" || c.status === "missing");
  const hasWarning = Object.values(checks).some((c) => c.status === "warning");

  return NextResponse.json(
    {
      status: hasError ? "unhealthy" : hasWarning ? "degraded" : "healthy",
      timestamp: new Date().toISOString(),
      responseMs: Date.now() - startedAt,
      checks,
    },
    { status: hasError ? 503 : 200 },
  );
}
