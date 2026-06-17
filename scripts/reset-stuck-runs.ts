import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { pipelineRuns } from "../src/lib/db/schema";
import { inArray } from "drizzle-orm";

// Load .env.local (then .env) so this works without dotenv-cli, same as db:seed.
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * Clear pipeline runs that are stuck in "running" or "pending". This happens
 * when the dev server (or a serverless function) is restarted/killed mid-run:
 * the DB row never gets flipped to a terminal status, so the dashboard shows a
 * ghost "running" run forever and the concurrency lock blocks new/continued
 * runs until the 30-minute staleness timeout kicks in.
 *
 * Marking them "failed" (preserving currentStep) lets the dashboard show the
 * "Continue from step N" button so you can resume without re-running earlier
 * steps.
 */
async function main() {
  const dbUrl = process.env.TURSO_DATABASE_URL || "file:./neopod.db";
  const client = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const db = drizzle(client);

  const stuck = await db
    .select({ id: pipelineRuns.id, currentStep: pipelineRuns.currentStep, status: pipelineRuns.status })
    .from(pipelineRuns)
    .where(inArray(pipelineRuns.status, ["running", "pending"]))
    .all();

  if (stuck.length === 0) {
    console.log("No stuck runs found — nothing to clear.");
    process.exit(0);
  }

  for (const r of stuck) {
    console.log(`  - Run ${r.id} was "${r.status}" at step ${r.currentStep} → marking failed`);
  }

  const result = await db
    .update(pipelineRuns)
    .set({
      status: "failed",
      error: "Run was interrupted (dev server restart / timeout) and manually cleared",
      completedAt: new Date().toISOString(),
    })
    .where(inArray(pipelineRuns.status, ["running", "pending"]))
    .run();

  console.log(`Cleared ${result.rowsAffected} stuck run(s). The dashboard will now show "Continue from step N".`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed to clear stuck runs:", err);
  process.exit(1);
});
