import { config } from "dotenv";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { dailyCosts, costEntries } from "../src/lib/db/schema";
import { eq, like } from "drizzle-orm";

// Load .env.local (then .env) so this works without dotenv-cli, same as db:seed.
config({ path: ".env.local" });
config({ path: ".env" });

/**
 * One-off repair: an earlier version of step-04 PRE-RECORDED image + vision
 * cost before calling the provider, and never refunded it when the call failed
 * (e.g. a 429 rate-limit generates no image and is never billed). That inflated
 * the daily/lifetime ledger far above real provider spend and falsely tripped
 * the daily budget cap.
 *
 * This script removes those phantom "pre-record" line items and resets the
 * affected day's totals to 0 so the (now-fixed) accurate accounting starts
 * clean. Pass a date as the first arg (YYYY-MM-DD) or it defaults to today.
 */
async function main() {
  const date = process.argv[2] || new Date().toISOString().split("T")[0];

  const dbUrl = process.env.TURSO_DATABASE_URL || "file:./neopod.db";
  const client = createClient({ url: dbUrl, authToken: process.env.TURSO_AUTH_TOKEN });
  const db = drizzle(client);

  console.log(`Resetting cost ledger for ${date}...`);

  // Delete the phantom pre-record entries (they were never billed by the provider).
  const phantom = await db.delete(costEntries).where(like(costEntries.description, "%pre-record%")).run();
  console.log(`  - Deleted ${phantom.rowsAffected} phantom "pre-record" cost entries`);

  // Reset the day's running totals to 0 so accurate accounting starts fresh.
  const reset = await db
    .update(dailyCosts)
    .set({ totalCost: 0, aiCost: 0, apiCost: 0, listingFees: 0, updatedAt: new Date().toISOString() })
    .where(eq(dailyCosts.date, date))
    .run();
  console.log(`  - Reset ${reset.rowsAffected} daily_costs row(s) for ${date} to $0.00`);

  console.log("Done. The budget for today is clear; the fixed step-04 will now record only real, completed spend.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
