import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalQueueEntries, etsyListings, printifyProducts, mockups, designConcepts, niches } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const rows = await db
    .select({
      entry: approvalQueueEntries,
      listing: etsyListings,
      product: printifyProducts,
      concept: designConcepts,
      niche: niches,
    })
    .from(approvalQueueEntries)
    .leftJoin(etsyListings, eq(approvalQueueEntries.etsyListingId, etsyListings.id))
    .leftJoin(printifyProducts, eq(etsyListings.printifyProductId, printifyProducts.id))
    .leftJoin(designConcepts, eq(printifyProducts.designConceptId, designConcepts.id))
    .leftJoin(niches, eq(designConcepts.nicheId, niches.id))
    .where(eq(approvalQueueEntries.status, "pending"))
    .orderBy(approvalQueueEntries.batchNumber, approvalQueueEntries.batchOrder)
    .all();

  if (rows.length === 0) {
    return NextResponse.json({ entries: [] });
  }

  const productIds = Array.from(
    new Set(rows.map((r) => r.product?.id).filter((id): id is string => Boolean(id))),
  );

  const allMockups = productIds.length > 0
    ? await db
        .select()
        .from(mockups)
        .where(inArray(mockups.printifyProductId, productIds))
        .all()
    : [];

  const mockupsByProduct = new Map<string, typeof allMockups>();
  for (const m of allMockups) {
    const arr = mockupsByProduct.get(m.printifyProductId) ?? [];
    arr.push(m);
    mockupsByProduct.set(m.printifyProductId, arr);
  }

  const entries = rows.map((row) => ({
    ...row.entry,
    listing: row.listing,
    product: row.product,
    concept: row.concept,
    niche: row.niche,
    mockups: row.product ? mockupsByProduct.get(row.product.id) ?? [] : [],
  }));

  return NextResponse.json({ entries });
}
