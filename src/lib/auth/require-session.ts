import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { isValidSession } from "./sessions";

/**
 * Validate the session cookie against the DB (Node runtime).
 * Middleware only checks cookie format; the real check lives here so it can
 * use `@libsql/client` with file:// URLs during dev.
 */
export async function requireSession(): Promise<string> {
  const token = cookies().get("neo-pod-auth")?.value;
  if (!token || !(await isValidSession(token))) {
    redirect("/login");
  }
  return token;
}

/** For API routes: returns 401 response instead of redirect when invalid. */
export async function requireSessionApi(): Promise<NextResponse | null> {
  const token = cookies().get("neo-pod-auth")?.value;
  if (!token || !(await isValidSession(token))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
