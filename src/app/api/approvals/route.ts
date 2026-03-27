import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalQueueEntries, etsyListings, printifyProducts, mockups, designConcepts, niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  const entries = await db
    .select()
    .from(approvalQueueEntries)
    .where(eq(approvalQueueEntries.status, "pending"))
    .orderBy(approvalQueueEntries.batchNumber, approvalQueueEntries.batchOrder)
    .all();

  // Enrich with listing and product data
  const enriched = await Promise.all(
    entries.map(async (entry) => {
      const listing = await db.select().from(etsyListings).where(eq(etsyListings.id, entry.etsyListingId)).get();
      if (!listing) return { ...entry, listing: null, product: null, mockups: [], concept: null, niche: null };

      const product = await db.select().from(printifyProducts).where(eq(printifyProducts.id, listing.printifyProductId)).get();
      const productMockups = product ? await db.select().from(mockups).where(eq(mockups.printifyProductId, product.id)).all() : [];
      const concept = product ? await db.select().from(designConcepts).where(eq(designConcepts.id, product.designConceptId)).get() : null;
      const niche = concept ? await db.select().from(niches).where(eq(niches.id, concept.nicheId)).get() : null;

      return {
        ...entry,
        listing,
        product,
        mockups: productMockups,
        concept,
        niche,
      };
    }),
  );

  return NextResponse.json({ entries: enriched });
}
