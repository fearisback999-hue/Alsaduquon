import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const allOrders = await db
    .select()
    .from(orders)
    .orderBy(desc(orders.createdAt))
    .limit(100)
    .all();

  return NextResponse.json({ orders: allOrders });
}
