import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { approvalQueueEntries, listings, printifyProducts, mockups, designConcepts, niches, generatedImages } from "@/lib/db/schema";
import { eq, and, gte, inArray, desc } from "drizzle-orm";
import { requireSessionApi } from "@/lib/auth/require-session";
import * as etsy from "@/lib/external/etsy";
import { getPlatform } from "@/lib/platforms/registry";
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

  const listing = await db.select().from(listings).where(eq(listings.id, entry.listingId)).get();
  if (!listing) return NextResponse.json({ error: "Listing not found" }, { status: 404 });

  let platformDeactivated = false;
  if (listing.status === "published" && listing.externalListingId) {
    try {
      if (listing.platform === "etsy") {
        await etsy.updateListing(parseInt(listing.externalListingId), { state: "inactive" });
      } else {
        const platform = getPlatform(listing.platform);
        if (platform) {
          await platform.deactivateListing(listing.externalListingId);
        }
      }
      platformDeactivated = true;
      log("info", `Retroactively deactivated published listing on ${listing.platform}: "${listing.title}"`);
    } catch (err) {
      log("error", `Failed to deactivate listing on ${listing.platform}: ${listing.title}`, {
        error: err instanceof Error ? err.message : String(err),
      });
      return NextResponse.json(
        { error: `Failed to deactivate on ${listing.platform}`, details: err instanceof Error ? err.message : String(err) },
        { status: 502 },
      );
    }
  }

  const now = new Date().toISOString();
  await db.update(approvalQueueEntries).set({
    status: "rejected",
    feedback: `[Retroactive reject${platformDeactivated ? `, deactivated on ${listing.platform}` : ""}] ${reason ?? ""}`.trim(),
    updatedAt: now,
  }).where(eq(approvalQueueEntries.id, entryId));

  await db.update(listings).set({
    status: platformDeactivated ? "deactivated" : "rejected",
    updatedAt: now,
  }).where(eq(listings.id, listing.id));

  return NextResponse.json({ success: true, platformDeactivated });
}
