import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { dailyCosts, costEntries, tokenUsages } from "@/lib/db/schema";
import { desc, eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const days = parseInt(searchParams.get("days") ?? "30");

  const costs = await db
    .select()
    .from(dailyCosts)
    .orderBy(desc(dailyCosts.date))
    .limit(days)
    .all();

  // Today's detail
  const today = new Date().toISOString().split("T")[0];
  const todayEntries = await db
    .select()
    .from(costEntries)
    .where(eq(costEntries.date, today))
    .all();

  // Recent token usage
  const recentTokens = await db
    .select()
    .from(tokenUsages)
    .orderBy(desc(tokenUsages.createdAt))
    .limit(50)
    .all();

  return NextResponse.json({ dailyCosts: costs, todayEntries, recentTokenUsage: recentTokens });
}
