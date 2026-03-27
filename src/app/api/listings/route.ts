import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { etsyListings } from "@/lib/db/schema";
import { eq, desc, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const status = searchParams.get("status");
  const limit = Math.min(parseInt(searchParams.get("limit") ?? "50"), 100);
  const offset = parseInt(searchParams.get("offset") ?? "0");

  const condition = status ? eq(etsyListings.status, status as any) : sql`1=1`;

  const listings = await db
    .select()
    .from(etsyListings)
    .where(condition)
    .orderBy(desc(etsyListings.createdAt))
    .limit(limit)
    .offset(offset)
    .all();

  return NextResponse.json({ listings });
}
