import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/auth/require-session";
import { db } from "@/lib/db";
import { designConcepts, generatedImages } from "@/lib/db/schema";
import { eq, sql } from "drizzle-orm";
import { log } from "@/lib/logger";

export const dynamic = "force-dynamic";

/**
 * Reset all failed design concepts back to "moderated" so the next pipeline
 * run retries image generation. Also clears their failed image records so
 * the retry counter resets. Use after fixing a root cause (adding API key,
 * topping up credits, etc.).
 */
export async function POST() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const failed = await db
    .select({ id: designConcepts.id, title: designConcepts.title })
    .from(designConcepts)
    .where(eq(designConcepts.status, "failed"))
    .all();

  if (failed.length === 0) {
    return NextResponse.json({ reset: 0, message: "No failed concepts to reset" });
  }

  // Reset concepts to moderated
  const result = await db
    .update(designConcepts)
    .set({ status: "moderated" })
    .where(eq(designConcepts.status, "failed"));

  // Clear failed image records so retry counter resets
  const deleted = await db
    .delete(generatedImages)
    .where(eq(generatedImages.status, "failed"));

  log("info", `[Reset] Manually reset ${failed.length} failed concepts back to moderated for retry`);

  return NextResponse.json({
    reset: failed.length,
    message: `Reset ${failed.length} failed concepts — they will be retried on the next pipeline run`,
  });
}
