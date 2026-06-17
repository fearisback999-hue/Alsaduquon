import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { niches } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireSessionApi } from "@/lib/auth/require-session";

const createNicheSchema = z.object({
  name: z.string().min(2).max(120),
  category: z.string().max(60).optional(),
});

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["discovered", "scored", "approved", "rejected", "active", "exhausted"] as const;

export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1), 100);

  if (status && !VALID_STATUSES.includes(status as typeof VALID_STATUSES[number])) {
    return NextResponse.json({ error: "Invalid status filter" }, { status: 400 });
  }

  const condition = status
    ? eq(niches.status, status as typeof VALID_STATUSES[number])
    : sql`1=1`;

  const results = await db
    .select()
    .from(niches)
    .where(condition)
    .orderBy(desc(niches.compositeScore))
    .limit(limit)
    .all();

  return NextResponse.json({ niches: results });
}

export async function POST(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = createNicheSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid request", details: parsed.error.issues.map((i) => i.message) },
      { status: 400 },
    );
  }

  const normalizedName = parsed.data.name.toLowerCase().trim();
  const category = parsed.data.category;

  const existing = await db
    .select({ id: niches.id })
    .from(niches)
    .where(eq(niches.name, normalizedName))
    .get();

  if (existing) {
    return NextResponse.json({ error: "A niche with this name already exists" }, { status: 409 });
  }

  const [inserted] = await db.insert(niches).values({
    name: normalizedName,
    category: category?.trim().slice(0, 60) || null,
    source: "manual",
    status: "discovered",
  }).returning();

  return NextResponse.json({ niche: inserted }, { status: 201 });
}
