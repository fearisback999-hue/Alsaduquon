import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { z } from "zod";

export const dynamic = "force-dynamic";

const ALLOWED_SETTINGS_KEYS = [
  "niche_score_threshold", "concepts_per_niche", "max_image_attempts",
  "mockups_per_product", "approval_batch_size", "approval_mode",
  "base_price", "margin_percent", "max_title_length", "max_tags",
  "max_daily_cost", "max_daily_listings", "max_products_per_design", "pipeline_runs_per_day",
  "dalle_model", "dalle_quality", "gpt_model",
  "enabled_product_types",
  "seasonal_boost_enabled",
] as const;

const updateSettingSchema = z.object({
  key: z.enum(ALLOWED_SETTINGS_KEYS),
  value: z.string().max(1000),
});

export async function GET() {
  const allSettings = await db.select().from(settings).all();
  return NextResponse.json({ settings: allSettings });
}

export async function PUT(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const parsed = updateSettingSchema.safeParse(body);

  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const { key, value } = parsed.data;

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

  return NextResponse.json({ success: true });
}
