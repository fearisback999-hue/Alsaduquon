import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";
import { eq, lt } from "drizzle-orm";

export const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export async function createSession(token: string, meta?: { ip?: string; userAgent?: string }): Promise<void> {
  await db.insert(sessions).values({
    token,
    expiresAt: Date.now() + SESSION_TTL_MS,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
  }).run();
}

export async function isValidSession(token: string): Promise<boolean> {
  const row = await db
    .select({ expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.token, token))
    .get();
  if (!row) return false;
  if (row.expiresAt < Date.now()) {
    await db.delete(sessions).where(eq(sessions.token, token)).run();
    return false;
  }
  return true;
}

export async function deleteSession(token: string): Promise<void> {
  await db.delete(sessions).where(eq(sessions.token, token)).run();
}

export async function purgeExpiredSessions(): Promise<number> {
  const result = await db.delete(sessions).where(lt(sessions.expiresAt, Date.now())).run();
  return Number(result.rowsAffected ?? 0);
}
