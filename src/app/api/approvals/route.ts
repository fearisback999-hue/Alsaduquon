import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalQueueEntries, listings, printifyProducts, mockups, designConcepts, niches } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";

export const dynamic = "force-dynamic";

export async function GET() {
  const denied = await requireSessionApi();
  if (denied) return denied;
  const rows = await db
    .select({
      entry: approvalQueueEntries,
      listing: listings,
      product: printifyProducts,
      concept: designConcepts,
      niche: niches,
    })
    .from(approvalQueueEntries)
    .leftJoin(listings, eq(approvalQueueEntries.listingId, listings.id))
    .leftJoin(printifyProducts, eq(listings.printifyProductId, printifyProducts.id))
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
  // Sort: mockups with URLs first, then primary first, then by sortOrder
  mockupsByProduct.forEach((arr) => {
    arr.sort((a, b) => {
      const aUrl = a.storageUrl ? 0 : 1;
      const bUrl = b.storageUrl ? 0 : 1;
      if (aUrl !== bUrl) return aUrl - bUrl;
      const aPrimary = a.isPrimary ? 0 : 1;
      const bPrimary = b.isPrimary ? 0 : 1;
      if (aPrimary !== bPrimary) return aPrimary - bPrimary;
      return (a.sortOrder ?? 99) - (b.sortOrder ?? 99);
    });
  });

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
