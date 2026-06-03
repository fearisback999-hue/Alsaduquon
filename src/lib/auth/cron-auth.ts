import { NextRequest, NextResponse } from "next/server";

export function verifyCronSecret(request: NextRequest): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  // Fail CLOSED in production: an unset CRON_SECRET must never leave the
  // budget-spending cron endpoints (pipeline trigger, order sync, optimize)
  // open to the public. Anyone hitting /api/cron/pipeline can otherwise burn
  // the entire OpenAI/Printify budget and flood the shop with listings.
  if (isProd && !secret) {
    return NextResponse.json(
      { error: "Cron authentication is not configured" },
      { status: 503 },
    );
  }

  // Dev convenience: allow local cron testing without a secret configured.
  if (!secret) return null;

  const auth = request.headers.get("authorization");
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return null;
}
