import { NextRequest, NextResponse } from "next/server";

// Session tokens stored in memory per serverless instance.
// For a single-user admin dashboard this is sufficient.
// The login route exports isValidSession but middleware can't import app code,
// so we use a shared module approach via a global set.
const getValidSessions = (): Set<string> => {
  const g = globalThis as unknown as { _neopodSessions?: Set<string> };
  if (!g._neopodSessions) g._neopodSessions = new Set();
  return g._neopodSessions;
};

// Re-export for login route to use the same set
export { getValidSessions };

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (process.env.NODE_ENV === "production") {
    response.headers.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return response;
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cron routes use CRON_SECRET header
  if (pathname.startsWith("/api/cron/")) {
    const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
    if (cronSecret !== process.env.CRON_SECRET) {
      return addSecurityHeaders(
        NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
      );
    }
    return addSecurityHeaders(NextResponse.next());
  }

  // Health check is public
  if (pathname === "/api/health") {
    return addSecurityHeaders(NextResponse.next());
  }

  // Login page and login API are public
  if (pathname === "/login" || pathname === "/api/auth/login") {
    return addSecurityHeaders(NextResponse.next());
  }

  // All other /dashboard and /api routes require auth
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/")) {
    const authCookie = request.cookies.get("neo-pod-auth")?.value;

    // Validate session token (not the raw password)
    const isValid = authCookie ? getValidSessions().has(authCookie) : false;

    // Fallback: also accept password match for backwards compat during first login
    const isPasswordMatch = authCookie === process.env.ADMIN_PASSWORD;

    if (!isValid && !isPasswordMatch) {
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
