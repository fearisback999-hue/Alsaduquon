import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Cron routes use CRON_SECRET header
  if (pathname.startsWith("/api/cron/")) {
    const cronSecret = request.headers.get("authorization")?.replace("Bearer ", "");
    if (cronSecret !== process.env.CRON_SECRET) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // Health check is public
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // Login page and login API are public
  if (pathname === "/login" || pathname === "/api/auth/login") {
    return NextResponse.next();
  }

  // All other /dashboard and /api routes require auth
  if (pathname.startsWith("/dashboard") || pathname.startsWith("/api/")) {
    const authCookie = request.cookies.get("neo-pod-auth")?.value;
    if (authCookie !== process.env.ADMIN_PASSWORD) {
      if (pathname.startsWith("/api/")) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
      return NextResponse.redirect(new URL("/login", request.url));
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*", "/login"],
};
