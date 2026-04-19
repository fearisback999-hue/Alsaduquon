import { NextRequest, NextResponse } from "next/server";
import { isValidSession } from "@/lib/auth/sessions";

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

export async function middleware(request: NextRequest) {
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

  // Login, logout, and login page are public
  if (pathname === "/login" || pathname === "/api/auth/login" || pathname === "/api/auth/logout") {
    return addSecurityHeaders(NextResponse.next());
  }

  // All other /dashboard and /api routes require auth
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/")) {
    const authCookie = request.cookies.get("neo-pod-auth")?.value;
    const isValid = authCookie ? await isValidSession(authCookie) : false;

    if (!isValid) {
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
