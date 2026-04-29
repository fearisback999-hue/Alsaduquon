import type { PipelineContext, StepResult } from "../context";
import { printifyProducts, mockups, listings, designConcepts, niches, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getEnabledPlatforms } from "@/lib/platforms/registry";
import type { PlatformStrategy } from "@/lib/platforms/types";
import { generatePlatformTitle, generatePlatformDescription, generatePlatformTags, calculateSEOScore } from "@/lib/seo/platform-seo";
import { getProductDisplayName } from "@/lib/printify/product-config";
import { calculateDynamicPrice } from "@/lib/pricing/engine";
import { fullModeration } from "@/lib/ai/moderation";
import { enforcebudget } from "@/lib/cost/guard";
import { recordCost } from "@/lib/cost/guard";
import { log } from "@/lib/logger";

async function getEnabledPlatformSetting(db: PipelineContext["db"]): Promise<string[]> {
  const row = await db.select().from(settings).where(eq(settings.key, "enabled_platforms")).get();
  if (!row) return ["etsy"];
  try { return JSON.parse(row.value); } catch { return ["etsy"]; }
}

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped listing generation" };
  }

  const enabledPlatformIds = await getEnabledPlatformSetting(context.db);
  const platforms = getEnabledPlatforms().filter(p => enabledPlatformIds.includes(p.id));

  if (platforms.length === 0) {
    return { status: "skipped", message: "No platforms enabled or configured" };
  }

  const products = context.createdProductIds.length > 0
    ? await context.db.select().from(printifyProducts).where(inArray(printifyProducts.id, context.createdProductIds)).all()
    : await context.db.select().from(printifyProducts).where(eq(printifyProducts.status, "created")).all();

  const byConceptId = new Map<string, typeof products>();
  for (const product of products) {
    const group = byConceptId.get(product.designConceptId) ?? [];
    group.push(product);
    byConceptId.set(product.designConceptId, group);
  }

  let created = 0;
  let failed = 0;
  let moderationRejects = 0;
  const perPlatform: Record<string, number> = {};

  for (const [conceptId, conceptProducts] of Array.from(byConceptId.entries())) {
    const primaryProduct = conceptProducts.find((p) => p.productType === "unisex_tshirt") ?? conceptProducts[0];

    const concept = await context.db.select().from(designConcepts).where(eq(designConcepts.id, conceptId)).get();
    const niche = concept ? await context.db.select().from(niches).where(eq(niches.id, concept.nicheId)).get() : null;
    if (!concept || !niche) continue;

    const productDisplayName = getProductDisplayName(primaryProduct.productType);
    const pricing = calculateDynamicPrice({
      productType: primaryProduct.productType,
      baseCost: primaryProduct.baseCost ?? 15,
      nicheCompositeScore: niche.compositeScore ?? undefined,
      competitionLevel: niche.competitionLevel ?? undefined,
      trendDirection: niche.trendDirection ?? undefined,
      marginPercent: 40,
    });
    const retailPrice = pricing.retailPrice;

    const productMockups = await context.db
      .select()
      .from(mockups)
      .where(eq(mockups.printifyProductId, primaryProduct.id))
      .all();

    const imageUrls = productMockups
      .slice(0, 10)
      .map(m => m.storageUrl ?? m.originalUrl!)
      .filter(Boolean);

    for (const platform of platforms) {
      const existingListing = await context.db
        .select()
        .from(listings)
        .where(eq(listings.printifyProductId, primaryProduct.id))
        .all();
      if (existingListing.some(l => l.platform === platform.id)) continue;

      await enforcebudget(0.05);

      const seoHints = platform.getSEOHints();
      const title = await generatePlatformTitle(niche.name, concept.title, productDisplayName, seoHints, context.pipelineRunId);
      const description = await generatePlatformDescription(niche.name, concept.title, concept.description ?? "", productDisplayName, seoHints, context.pipelineRunId);
      const tags = await generatePlatformTags(niche.name, concept.title, productDisplayName, seoHints, context.pipelineRunId);

      const modResult = await fullModeration(`${title} ${description} ${tags.join(" ")}`);
      if (!modResult.passed) {
        moderationRejects++;
        continue;
      }

      const seoScore = calculateSEOScore(title, description, tags);
      const listingFee = platform.getListingFee();
      const feeCategory = `${platform.id}_fee` as Parameters<typeof recordCost>[0];

      try {
        const result = await platform.createDraftListing({
          title,
          description,
          price: retailPrice,
          tags,
          imageUrls,
          productType: primaryProduct.productType,
          printifyProductId: primaryProduct.printifyProductId ?? undefined,
          printifyShopId: primaryProduct.printifyShopId ?? undefined,
        });

        if (imageUrls.length > 0) {
          await platform.uploadImages(result.externalId, imageUrls);
        }

        if (listingFee > 0) {
          await recordCost(feeCategory, listingFee, {
            description: `${platform.name} listing fee`,
            referenceId: result.externalId,
            referenceType: `${platform.id}_listing`,
          });
        }

        const [listing] = await context.db.insert(listings).values({
          platform: platform.id,
          printifyProductId: primaryProduct.id,
          externalListingId: result.externalId,
          title,
          description,
          tags: JSON.stringify(tags),
          seoScore,
          basePrice: primaryProduct.baseCost ?? 15,
          marginPercent: 40,
          finalPrice: retailPrice,
          externalState: result.state,
          externalUrl: result.url,
          status: "pending_approval",
          moderationResult: JSON.stringify(modResult),
          pipelineRunId: context.pipelineRunId,
        }).returning();

        context.draftListingIds.push(listing.id);
        created++;
        perPlatform[platform.id] = (perPlatform[platform.id] ?? 0) + 1;
      } catch (error) {
        log("error", `[Step 08] Draft listing creation failed on ${platform.id} for concept ${conceptId}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
      }
    }
  }

  const platformSummary = Object.entries(perPlatform).map(([p, n]) => `${p}: ${n}`).join(", ");

  return {
    status: "completed",
    message: `Created ${created} draft listings (${platformSummary}), ${failed} failed, ${moderationRejects} moderation rejected`,
    data: { created, failed, moderationRejects, perPlatform },
  };
}
