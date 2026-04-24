import { db } from "@/lib/db";
import { loginAttempts } from "@/lib/db/schema";
import { eq, lt, sql } from "drizzle-orm";

export const MAX_ATTEMPTS = 5;
export const LOCKOUT_MS = 15 * 60 * 1000; // 15 minutes

export async function isLockedOut(ip: string): Promise<boolean> {
  const row = await db
    .select({ count: loginAttempts.count, lastAttemptAt: loginAttempts.lastAttemptAt })
    .from(loginAttempts)
    .where(eq(loginAttempts.ip, ip))
    .get();
  if (!row) return false;
  if (Date.now() - row.lastAttemptAt > LOCKOUT_MS) {
    await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip)).run();
    return false;
  }
  return row.count >= MAX_ATTEMPTS;
}

export async function recordFailedAttempt(ip: string): Promise<void> {
  const now = Date.now();

  // Atomic upsert — avoids the TOCTOU race where two concurrent failed
  // logins both read count=0 and both try to INSERT.
  await db.insert(loginAttempts)
    .values({ ip, count: 1, lastAttemptAt: now })
    .onConflictDoUpdate({
      target: loginAttempts.ip,
      set: {
        count: sql`CASE WHEN ${now} - ${loginAttempts.lastAttemptAt} > ${LOCKOUT_MS} THEN 1 ELSE ${loginAttempts.count} + 1 END`,
        lastAttemptAt: now,
      },
    })
    .run();
}

export async function clearAttempts(ip: string): Promise<void> {
  await db.delete(loginAttempts).where(eq(loginAttempts.ip, ip)).run();
}

export async function purgeExpiredAttempts(): Promise<number> {
  const result = await db
    .delete(loginAttempts)
    .where(lt(loginAttempts.lastAttemptAt, Date.now() - LOCKOUT_MS))
    .run();
  return Number(result.rowsAffected ?? 0);
}
