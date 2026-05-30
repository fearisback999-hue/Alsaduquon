import { NextRequest, NextResponse } from "next/server";

const CSP_DIRECTIVES = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""} https://*.spline.design`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://*.spline.design https://*.splinecode.com",
  "worker-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  response.headers.set("Content-Security-Policy", CSP_DIRECTIVES);
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

// Tokens are 64 hex chars (32 random bytes). Reject obviously malformed cookies
// without hitting the database. Full DB-backed validation happens in the
// dashboard layout and API routes (Node runtime), where libsql works with
// file:// URLs.
function looksLikeValidToken(token: string | undefined): boolean {
  return !!token && /^[0-9a-f]{32,128}$/i.test(token);
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/api/cron/")) {
    const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
    const fromVercelCron = request.headers.get("x-vercel-cron") === "1";
    const authorized =
      cronSecret === process.env.CRON_SECRET &&
      (fromVercelCron || process.env.NODE_ENV !== "production");
    if (!authorized) {
      return addSecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return addSecurityHeaders(NextResponse.next());
  }

  if (pathname === "/api/health") {
    return addSecurityHeaders(NextResponse.next());
  }

  if (pathname === "/login" || pathname === "/api/auth/login" || pathname === "/api/auth/logout") {
    return addSecurityHeaders(NextResponse.next());
  }

  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/")) {
    const authCookie = request.cookies.get("neo-pod-auth")?.value;
    if (!looksLikeValidToken(authCookie)) {
      if (pathname.startsWith("/api/")) {
        return addSecurityHeaders(
          NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
        );
      }
      return addSecurityHeaders(
        NextResponse.redirect(new URL("/login", request.url)),
      );
    }
  }

  return addSecurityHeaders(NextResponse.next());
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*", "/login"],
};
