import type { PipelineContext, StepResult } from "../context";
import { printifyProducts, mockups, listings, designConcepts, niches, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { getEnabledPlatforms } from "@/lib/platforms/registry";
import { generatePlatformTitleVariants, generatePlatformDescription, generatePlatformTags, calculateSEOScore } from "@/lib/seo/platform-seo";
import { optimizeEtsyListing } from "@/lib/seo/etsy-optimizer";
import { getProductDisplayName } from "@/lib/printify/product-config";
import { calculateDynamicPrice, getTargetMargin } from "@/lib/pricing/engine";
import { fullModeration } from "@/lib/ai/moderation";
import { enforcebudget } from "@/lib/cost/guard";
import { recordCost } from "@/lib/cost/guard";
import * as printify from "@/lib/external/printify";
import type { ListingVariant } from "@/lib/platforms/types";
import { log } from "@/lib/logger";

/**
 * Builds the size/color variant list for a product by joining the per-variant
 * prices stored at Printify-creation time with the human-readable titles from
 * the print provider's catalog. Returns [] (single SKU) on any problem.
 */
async function buildListingVariants(product: {
  variants: string | null;
  blueprintId: number | null;
  printProviderId: number | null;
}): Promise<ListingVariant[]> {
  try {
    const stored = JSON.parse(product.variants ?? "[]") as Array<{ id: number; price: number; is_enabled: boolean }>;
    if (stored.length < 2 || !product.blueprintId || !product.printProviderId) return [];

    const catalog = await printify.getVariants(product.blueprintId, product.printProviderId);
    const titleById = new Map(catalog.variants.map((v) => [v.id, v.title]));

    return stored
      .map((sv) => ({ title: titleById.get(sv.id) ?? "", priceCents: sv.price, enabled: sv.is_enabled }))
      .filter((v) => v.title.length > 0);
  } catch (error) {
    log("warn", "[Step 08] Could not build variant list; listing will be single-SKU", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

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
    const targetMargin = getTargetMargin(primaryProduct.productType, niche.competitionLevel);
    const pricing = calculateDynamicPrice({
      productType: primaryProduct.productType,
      baseCost: primaryProduct.baseCost ?? 15,
      nicheCompositeScore: niche.compositeScore ?? undefined,
      competitionLevel: niche.competitionLevel ?? undefined,
      trendDirection: niche.trendDirection ?? undefined,
      marginPercent: targetMargin,
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

    // Size/color variants (built once; applied per platform that supports them)
    const listingVariants = await buildListingVariants(primaryProduct);

    const existingListings = await context.db
      .select({ platform: listings.platform })
      .from(listings)
      .where(eq(listings.printifyProductId, primaryProduct.id))
      .all();
    const existingPlatforms = new Set(existingListings.map((l) => l.platform));

    for (const platform of platforms) {
      if (existingPlatforms.has(platform.id)) continue;

      await enforcebudget(0.05);

      const seoHints = platform.getSEOHints();
      // Real marketplace signals from Step 1 research — drives keyword choice
      // instead of letting the model free-associate blind.
      const marketData = {
        searchVolume: niche.searchVolume,
        competitionLevel: niche.competitionLevel,
        trendDirection: niche.trendDirection,
      };
      const titleVariants = await generatePlatformTitleVariants(niche.name, concept.title, productDisplayName, seoHints, context.pipelineRunId, marketData);
      const description = await generatePlatformDescription(niche.name, concept.title, concept.description ?? "", productDisplayName, seoHints, context.pipelineRunId, marketData);
      const rawTags = await generatePlatformTags(niche.name, concept.title, productDisplayName, seoHints, context.pipelineRunId, marketData);

      // Generate a second description variant with a different angle
      const descriptionAlt = await generatePlatformDescription(
        niche.name,
        concept.title,
        (concept.description ?? "") + "\n\nWrite a DIFFERENT version with an alternative angle — fresh structure, different emotional hook, alternate buyer persona.",
        productDisplayName,
        seoHints,
        context.pipelineRunId,
        marketData,
      );

      // Generate a second tag set variant
      const tagsAlt = await generatePlatformTags(niche.name, concept.title, productDisplayName, seoHints, context.pipelineRunId, marketData);

      // Deterministic Etsy-SEO finishing pass: pick the strongest title by
      // Etsy's ranking rubric, mirror its phrases into tags, and fill all 13
      // slots with buyer-intent long-tail. Applies the mechanical levers the
      // LLM uses inconsistently — every listing, every time.
      const seo = optimizeEtsyListing({
        niche: niche.name,
        conceptTitle: concept.title,
        productType: productDisplayName,
        titleVariants,
        tags: rawTags,
        buyerPersona: niche.buyerPersona,
        occasion: niche.occasion,
        maxTitleLength: seoHints.titleMaxLength,
        maxTags: seoHints.maxTags,
        maxTagLength: seoHints.tagMaxLength,
      });
      const title = seo.title;
      const tags = seo.tags;
      const orderedTitleVariants = seo.titleVariants;
      log("info", `[Step 08] SEO-optimized "${niche.name}" — title ${seo.titleScore}/100 (${seo.rationale.join("; ")}), ${tags.length} tags`);

      const descriptionVariants = JSON.stringify([description, descriptionAlt]);
      const tagVariants = JSON.stringify([tags, tagsAlt]);

      const modResult = await fullModeration(`${title} ${description} ${tags.join(" ")}`);
      if (!modResult.passed) {
        const reasons: string[] = [];
        if (modResult.openaiResult.flagged) reasons.push(`openai: ${modResult.openaiResult.categories.join(", ")}`);
        if (!modResult.etsyResult.passed) reasons.push(`policy: ${modResult.etsyResult.violations.join("; ")}`);
        log("warn", `[Step 08] Moderation rejected listing for "${niche.name}" / "${concept.title}" on ${platform.id}: ${reasons.join(" | ")}`);
        moderationRejects++;
        continue;
      }

      const seoScore = calculateSEOScore(title, description, tags, seoHints);
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

        // Add size/color variations so buyers can pick (apparel without a size
        // selector barely converts). Fail-safe: the listing stays single-SKU
        // if the platform doesn't support it or the call fails.
        if (listingVariants.length > 1 && platform.syncVariants) {
          await platform.syncVariants(result.externalId, primaryProduct.productType, listingVariants);
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
          titleVariants: orderedTitleVariants.length > 1 ? JSON.stringify(orderedTitleVariants) : null,
          titleVariantIndex: 0,
          description,
          descriptionVariants,
          descriptionVariantIndex: 0,
          tags: JSON.stringify(tags),
          tagVariants,
          tagVariantIndex: 0,
          seoScore,
          basePrice: primaryProduct.baseCost ?? 15,
          marginPercent: targetMargin,
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
