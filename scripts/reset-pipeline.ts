/**
 * Resets pipeline state so the next run starts fresh.
 * Deletes all niches, design concepts, and resets the score threshold.
 * Run with: npx tsx scripts/reset-pipeline.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });
config({ path: ".env" });

import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { niches, designConcepts, settings } from "../src/lib/db/schema";
import { eq, sql } from "drizzle-orm";

async function reset() {
  const dbUrl = process.env.TURSO_DATABASE_URL || "file:./neopod.db";
  const client = createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });
  const db = drizzle(client);

  // 1. Delete all design concepts (cascade would handle this, but be explicit)
  const conceptCount = await db.select({ count: sql<number>`count(*)` }).from(designConcepts).get();
  await db.delete(designConcepts);
  console.log(`Deleted ${conceptCount?.count ?? 0} design concepts`);

  // 2. Delete all niches
  const nicheCount = await db.select({ count: sql<number>`count(*)` }).from(niches).get();
  await db.delete(niches);
  console.log(`Deleted ${nicheCount?.count ?? 0} niches`);

  // 3. Update score threshold to 5.5
  const threshold = await db.select().from(settings).where(eq(settings.key, "niche_score_threshold")).get();
  if (threshold) {
    await db.update(settings).set({ value: "5.5", updatedAt: new Date().toISOString() }).where(eq(settings.key, "niche_score_threshold"));
    console.log(`Updated niche_score_threshold: ${threshold.value} → 5.5`);
  }

  // 4. Update max_daily_listings to 5 (Etsy bot safety)
  const listings = await db.select().from(settings).where(eq(settings.key, "max_daily_listings")).get();
  if (listings && Number(listings.value) > 5) {
    await db.update(settings).set({ value: "5", updatedAt: new Date().toISOString() }).where(eq(settings.key, "max_daily_listings"));
    console.log(`Updated max_daily_listings: ${listings.value} → 5`);
  }

  console.log("\nPipeline state reset. Run `npm run dev` and trigger a new pipeline run.");
  process.exit(0);
}

reset().catch((err) => {
  console.error("Reset failed:", err);
  process.exit(1);
});
