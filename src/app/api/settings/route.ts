import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings, dailyCosts } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireSessionApi } from "@/lib/auth/require-session";
import { validateSetting, SETTING_VALIDATORS } from "@/lib/settings/validators";

export const dynamic = "force-dynamic";

const updateSettingSchema = z.object({
  key: z.string().min(1).max(64),
  value: z.string().max(2000),
});

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const allSettings = await db.select().from(settings).all();
  return NextResponse.json({ settings: allSettings });
}

export async function PUT(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const body = await request.json().catch(() => null);
  const parsed = updateSettingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request body", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { key, value } = parsed.data;

  // Reject unknown keys
  if (!(key in SETTING_VALIDATORS)) {
    return NextResponse.json(
      { error: `Unknown setting key: ${key}` },
      { status: 400 },
    );
  }

  // Per-key validation — type, range, enum, JSON shape
  const validation = validateSetting(key, value);
  if (!validation.ok) {
    return NextResponse.json(
      { error: validation.error ?? "Invalid value" },
      { status: 400 },
    );
  }

  const existing = await db.select().from(settings).where(eq(settings.key, key)).get();

  if (existing) {
    await db.update(settings).set({
      value,
      updatedAt: new Date().toISOString(),
    }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({
      key,
      value,
      updatedAt: new Date().toISOString(),
    });
  }

  // CRITICAL: bridge settings to today's daily_costs row so budget changes
  // take effect immediately, not at midnight rollover. Without this, the
  // user can lower max_daily_cost to $5 but still spend $50 today because
  // the daily_costs row was created with the old default.
  if (key === "max_daily_cost") {
    const today = new Date().toISOString().split("T")[0];
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue >= 0) {
      await db
        .update(dailyCosts)
        .set({ maxDailyCost: numericValue, updatedAt: new Date().toISOString() })
        .where(eq(dailyCosts.date, today));
    }
  }
  if (key === "max_daily_listings") {
    const today = new Date().toISOString().split("T")[0];
    const numericValue = Number(value);
    if (Number.isFinite(numericValue) && numericValue >= 1) {
      await db
        .update(dailyCosts)
        .set({ maxDailyListings: Math.floor(numericValue), updatedAt: new Date().toISOString() })
        .where(eq(dailyCosts.date, today));
    }
  }

  return NextResponse.json({ success: true });
}
