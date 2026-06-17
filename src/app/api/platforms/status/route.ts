import { NextResponse } from "next/server";
import { requireSessionApi } from "@/lib/auth/require-session";
import { getPlatformReadiness } from "@/lib/platforms/readiness";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

/**
 * Authenticated platform readiness — which sales channels have credentials set
 * and which are currently enabled. Drives the multi-platform setup checklist.
 * Returns env var NAMES (not values), so it must stay behind auth.
 */
export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const readiness = getPlatformReadiness();

  const enabledSetting = await db.select().from(settings).where(eq(settings.key, "enabled_platforms")).get();
  let enabled: string[] = ["etsy"];
  if (enabledSetting) {
    try {
      const parsed = JSON.parse(enabledSetting.value);
      if (Array.isArray(parsed)) enabled = parsed;
    } catch { /* keep default */ }
  }

  const printifyReady = !!process.env.PRINTIFY_API_TOKEN && !!process.env.PRINTIFY_SHOP_ID;

  return NextResponse.json({
    printifyReady, // required for product creation on ALL platforms
    platforms: readiness.map((p) => ({ ...p, enabled: enabled.includes(p.id) })),
  });
}
