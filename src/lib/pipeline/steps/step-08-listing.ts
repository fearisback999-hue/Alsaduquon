import type { PipelineContext, StepResult } from "../context";
import { printifyProducts, mockups, etsyListings, designConcepts, niches } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as etsy from "@/lib/external/etsy";
import { generateListingTitle, generateListingDescription, generateListingTags, calculateSEOScore } from "@/lib/etsy/seo";
import { getProductDisplayName } from "@/lib/printify/product-config";
import { calculateRetailPrice } from "@/lib/etsy/pricing";
import { fullModeration } from "@/lib/ai/moderation";
import { enforcebudget } from "@/lib/cost/guard";
import { recordCost } from "@/lib/cost/guard";
import { ETSY_LISTING_FEE } from "@/lib/types";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped listing generation" };
  }

  // Get products that need listings (prefer t-shirts as primary listing)
  const products = context.createdProductIds.length > 0
    ? await context.db.select().from(printifyProducts).where(inArray(printifyProducts.id, context.createdProductIds)).all()
    : await context.db.select().from(printifyProducts).where(eq(printifyProducts.status, "created")).all();

  // Group by design concept — one listing per concept (using t-shirt as primary)
  const byConceptId = new Map<string, typeof products>();
  for (const product of products) {
    const group = byConceptId.get(product.designConceptId) ?? [];
    group.push(product);
    byConceptId.set(product.designConceptId, group);
  }

  let created = 0;
  let failed = 0;
  let moderationRejects = 0;

  for (const [conceptId, conceptProducts] of Array.from(byConceptId.entries())) {
    // Pick the first product as the primary listing product (ordered by creation)
    const primaryProduct = conceptProducts.find((p) => p.productType === "unisex_tshirt") ?? conceptProducts[0];

    // Idempotency: check if listing already exists
    const existingListing = await context.db
      .select()
      .from(etsyListings)
      .where(eq(etsyListings.printifyProductId, primaryProduct.id))
      .get();
    if (existingListing) continue;

    // Get concept and niche
    const concept = await context.db.select().from(designConcepts).where(eq(designConcepts.id, conceptId)).get();
    const niche = concept ? await context.db.select().from(niches).where(eq(niches.id, concept.nicheId)).get() : null;

    if (!concept || !niche) continue;

    await enforcebudget(0.05); // Estimated cost for SEO generation

    // Generate SEO-optimized listing content
    const productDisplayName = getProductDisplayName(primaryProduct.productType);
    const title = await generateListingTitle(niche.name, concept.title, productDisplayName, 140, context.pipelineRunId);
    const description = await generateListingDescription(niche.name, concept.title, concept.description ?? "", productDisplayName, context.pipelineRunId);
    const tags = await generateListingTags(niche.name, concept.title, productDisplayName, 13, context.pipelineRunId);

    // MODERATION CHECK on listing text (second gate — after concept moderation in step 3)
    const modResult = await fullModeration(`${title} ${description} ${tags.join(" ")}`);
    if (!modResult.passed) {
      moderationRejects++;
      continue;
    }

    const retailPrice = calculateRetailPrice(primaryProduct.baseCost ?? 15, 40, 25);
    const seoScore = calculateSEOScore(title, description, tags);

    try {
      // Create draft listing on Etsy
      const etsyResult = await etsy.createDraftListing({
        title,
        description,
        price: retailPrice,
        tags,
      });

      // Upload mockup images (up to 10)
      const productMockups = await context.db
        .select()
        .from(mockups)
        .where(eq(mockups.printifyProductId, primaryProduct.id))
        .all();

      for (let i = 0; i < Math.min(productMockups.length, 10); i++) {
        const mockup = productMockups[i];
        try {
          await etsy.uploadListingImage(etsyResult.listing_id, mockup.storageUrl ?? mockup.originalUrl!, i + 1);
        } catch {
          // Continue if one image fails
        }
      }

      // Record listing fee
      await recordCost("etsy_fee", ETSY_LISTING_FEE, {
        description: "Etsy listing fee",
        referenceId: String(etsyResult.listing_id),
        referenceType: "etsy_listing",
      });

      const [listing] = await context.db.insert(etsyListings).values({
        printifyProductId: primaryProduct.id,
        etsyListingId: String(etsyResult.listing_id),
        title,
        description,
        tags: JSON.stringify(tags),
        seoScore,
        basePrice: primaryProduct.baseCost ?? 15,
        marginPercent: 40,
        finalPrice: retailPrice,
        etsyState: "draft",
        etsyUrl: etsyResult.url,
        status: "pending_approval",
        moderationResult: JSON.stringify(modResult),
        pipelineRunId: context.pipelineRunId,
      }).returning();

      context.draftListingIds.push(listing.id);
      created++;
    } catch (error) {
      failed++;
    }
  }

  return {
    status: "completed",
    message: `Created ${created} Etsy draft listings, ${failed} failed, ${moderationRejects} moderation rejected`,
    data: { created, failed, moderationRejects },
  };
}
