import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { generatedImages } from "@/lib/db/schema";
import { and, eq, isNotNull, lt, inArray } from "drizzle-orm";
import { del } from "@vercel/blob";
import { log } from "@/lib/logger";
import { purgeExpiredSessions } from "@/lib/auth/sessions";
import { purgeExpiredAttempts } from "@/lib/auth/brute-force";
import { verifyCronSecret } from "@/lib/auth/cron-auth";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RETENTION_DAYS = 14;
const BATCH_SIZE = 50;

export async function GET(request: NextRequest) {
  const denied = verifyCronSecret(request);
  if (denied) return denied;
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();

  const stale = await db
    .select({ id: generatedImages.id, storageUrl: generatedImages.storageUrl })
    .from(generatedImages)
    .where(
      and(
        inArray(generatedImages.status, ["rejected", "failed"]),
        isNotNull(generatedImages.storageUrl),
        lt(generatedImages.createdAt, cutoff),
      ),
    )
    .limit(BATCH_SIZE)
    .all();

  let deleted = 0;
  let failed = 0;

  for (const row of stale) {
    if (!row.storageUrl) continue;
    try {
      await del(row.storageUrl);
      await db
        .update(generatedImages)
        .set({ storageUrl: null, storagePath: null })
        .where(eq(generatedImages.id, row.id));
      deleted++;
    } catch (error) {
      failed++;
      log("warn", "Blob cleanup failed", {
        id: row.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const [expiredSessions, expiredAttempts] = await Promise.all([
    purgeExpiredSessions(),
    purgeExpiredAttempts(),
  ]);

  log("info", "Cleanup cron completed", { deleted, failed, expiredSessions, expiredAttempts });
  return NextResponse.json({ deleted, failed, expiredSessions, expiredAttempts });
}
