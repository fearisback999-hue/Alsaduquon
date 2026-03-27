import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { niches } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);

  let query;
  if (status) {
    query = db.select().from(niches).where(eq(niches.status, status as any)).orderBy(desc(niches.compositeScore)).limit(limit);
  } else {
    query = db.select().from(niches).orderBy(desc(niches.compositeScore)).limit(limit);
  }

  const results = await query.all();
  return NextResponse.json({ niches: results });
}
