import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import crypto from "crypto";
import { createSession, deleteSession, SESSION_TTL_MS } from "@/lib/auth/sessions";
import { isLockedOut, recordFailedAttempt, clearAttempts } from "@/lib/auth/brute-force";

export const dynamic = "force-dynamic";

/**
 * Derive a brute-force tracking key that can't be trivially spoofed by
 * rotating x-forwarded-for. We hash ip + user-agent so an attacker would
 * need to rotate both to get a fresh attempt budget — still not perfect,
 * but materially harder than pure IP-based tracking.
 */
function getAttemptKey(request: NextRequest): string {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const ua = request.headers.get("user-agent") ?? "unknown";
  const hash = crypto.createHash("sha256").update(`${ip}|${ua}`).digest("hex").slice(0, 32);
  return hash;
}

function getClientIP(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
}

/**
 * Constant-time password comparison. HMACs both inputs first so length
 * differences don't leak — HMAC output is always fixed size.
 */
function timingSafeCompare(a: string, b: string): boolean {
  const key = crypto.randomBytes(32);
  const hashA = crypto.createHmac("sha256", key).update(a).digest();
  const hashB = crypto.createHmac("sha256", key).update(b).digest();
  return crypto.timingSafeEqual(hashA, hashB);
}

function generateSessionToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(request: NextRequest) {
  const attemptKey = getAttemptKey(request);
  const ip = getClientIP(request);

  if (await isLockedOut(attemptKey)) {
    return NextResponse.json(
      { error: "Too many failed attempts. Try again later." },
      { status: 429 },
    );
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body.password !== "string") {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { password } = body;
  const adminPassword = process.env.ADMIN_PASSWORD ?? "";

  if (!adminPassword || !timingSafeCompare(password, adminPassword)) {
    await recordFailedAttempt(attemptKey);
    return NextResponse.json({ error: "Invalid password" }, { status: 401 });
  }

  await clearAttempts(attemptKey);

  // Invalidate any existing session cookie on this browser before issuing a
  // new one — prevents session fixation where an attacker pre-sets a cookie.
  const cookieStore = await cookies();
  const existingToken = cookieStore.get("neo-pod-auth")?.value;
  if (existingToken) {
    await deleteSession(existingToken).catch(() => {});
  }

  const sessionToken = generateSessionToken();
  await createSession(sessionToken, {
    ip,
    userAgent: request.headers.get("user-agent") ?? undefined,
  });

  cookieStore.set("neo-pod-auth", sessionToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: Math.floor(SESSION_TTL_MS / 1000),
  });

  return NextResponse.json({ success: true });
}
