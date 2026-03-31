import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { niches } from "@/lib/db/schema";
import { desc, eq, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const VALID_STATUSES = ["discovered", "scored", "approved", "rejected", "active", "exhausted"] as const;

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(Math.max(parseInt(searchParams.get("limit") ?? "50") || 50, 1), 100);

  // Validate status enum if provided
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
