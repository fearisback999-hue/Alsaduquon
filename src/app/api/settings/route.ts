import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { settings } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const allSettings = await db.select().from(settings).all();
  return NextResponse.json({ settings: allSettings });
}

export async function PUT(request: NextRequest) {
  const { key, value } = await request.json();

  if (!key || value === undefined) {
    return NextResponse.json({ error: "key and value required" }, { status: 400 });
  }

  const existing = await db.select().from(settings).where(eq(settings.key, key)).get();

  if (existing) {
    await db.update(settings).set({
      value: String(value),
      updatedAt: new Date().toISOString(),
    }).where(eq(settings.key, key));
  } else {
    await db.insert(settings).values({
      key,
      value: String(value),
      updatedAt: new Date().toISOString(),
    });
  }

  return NextResponse.json({ success: true });
}
