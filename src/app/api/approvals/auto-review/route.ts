import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalQueueEntries, etsyListings, printifyProducts, mockups, designConcepts, niches, generatedImages } from "@/lib/db/schema";
import { eq, and, gte, inArray, desc } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";
import * as etsy from "@/lib/external/etsy";
import { log } from "@/lib/logger";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Lists auto-approved listings from the last N days (default 7) so the user
 * can retroactively reject anything that slipped through. If the listing has
 * already been published to Etsy, rejection deactivates it.
 */
export async function GET(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const { searchParams } = new URL(request.url);
  const days = Math.min(Math.max(parseInt(searchParams.get("days") ?? "7") || 7, 1), 30);
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

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
    .where(
      and(
        eq(approvalQueueEntries.mode, "auto"),
        eq(approvalQueueEntries.status, "approved"),
        gte(approvalQueueEntries.reviewedAt, cutoff),
      ),
    )
    .orderBy(desc(approvalQueueEntries.reviewedAt))
    .all();

  if (rows.length === 0) {
    return NextResponse.json({ entries: [], days });
  }

  const productIds = Array.from(
    new Set(rows.map((r) => r.product?.id).filter((id): id is string => Boolean(id))),
  );
  const imageIds = Array.from(
    new Set(rows.map((r) => r.product?.generatedImageId).filter((id): id is string => Boolean(id))),
  );

  const allMockups = productIds.length > 0
    ? await db.select().from(mockups).where(inArray(mockups.printifyProductId, productIds)).all()
    : [];

  const allImages = imageIds.length > 0
    ? await db.select().from(generatedImages).where(inArray(generatedImages.id, imageIds)).all()
    : [];

  const mockupsByProduct = new Map<string, typeof allMockups>();
  for (const m of allMockups) {
    const arr = mockupsByProduct.get(m.printifyProductId) ?? [];
    arr.push(m);
    mockupsByProduct.set(m.printifyProductId, arr);
  }

  const imagesById = new Map(allImages.map((img) => [img.id, img]));

  const entries = rows.map((row) => {
    const image = row.product?.generatedImageId ? imagesById.get(row.product.generatedImageId) : null;
    let qualityScores: Record<string, number> | null = null;
    if (image?.qualityScores) {
      try { qualityScores = JSON.parse(image.qualityScores); } catch { /* ignore */ }
    }
    return {
      ...row.entry,
      listing: row.listing,
      product: row.product,
      concept: row.concept,
      niche: row.niche,
      mockups: row.product ? mockupsByProduct.get(row.product.id) ?? [] : [],
      qualityScores,
      isPublished: row.listing?.status === "published",
    };
  });

  return NextResponse.json({ entries, days });
}

const rejectSchema = z.object({
  entryId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

/**
 * Retroactively rejects an auto-approved listing. If already published to
 * Etsy, deactivates it on the marketplace. Used when a bad design slipped
 * through auto-approval.
 */
export async function POST(request: NextRequest) {
  const denied = await requireSessionApi();
  if (denied) return denied;

  const body = await request.json().catch(() => null);
  const parsed = rejectSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const { entryId, reason } = parsed.data;

  const entry = await db.select().from(approvalQueueEntries).where(eq(approvalQueueEntries.id, entryId)).get();
  if (!entry) return NextResponse.json({ error: "Entry not found" }, { status: 404 });

  const listing = await db.select().from(etsyListings).where(eq(etsyListings.id, entry.etsyListingId)).get();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  let etsyDeactivated = false;
  if (listing.status === "published" && listing.etsyListingId) {
    try {
      await etsy.updateListing(parseInt(listing.etsyListingId), { state: "inactive" });
      etsyDeactivated = true;
      log("info", `Retroactively deactivated published listing on Etsy: "${listing.title}"`);
    } catch (err) {
      log("error", `Failed to deactivate listing on Etsy: ${listing.title}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: "Failed to deactivate on Etsy", details: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }

  const now = new Date().toISOString();
  await db.update(approvalQueueEntries).set({
    status: "rejected",
    feedback: `[Retroactive reject${etsyDeactivated ? ", deactivated on Etsy" : ""}] ${reason ?? ""}`.trim(),
    updatedAt: now,
  }).where(eq(approvalQueueEntries.id, entryId));

  await db.update(etsyListings).set({
    status: etsyDeactivated ? "deactivated" : "rejected",
    updatedAt: now,
  }).where(eq(etsyListings.id, listing.id));

  return NextResponse.json({ success: true, etsyDeactivated });
}
