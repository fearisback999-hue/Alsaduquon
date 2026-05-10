import type { PipelineContext, StepResult } from "../context";
import { generatedImages, designConcepts, niches, printifyProducts, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { getProductConfig, getProductDisplayName, ALL_PRODUCT_TYPES } from "@/lib/printify/product-config";
import { calculateDynamicPrice, calculateTeasePrice, getTypicalCost, getTargetMargin } from "@/lib/pricing/engine";
import { getProductTypePerformanceByNiche } from "@/lib/analytics/design-performance";
import { log } from "@/lib/logger";

async function getEnabledProductTypes(db: PipelineContext["db"]): Promise<string[]> {
  const setting = await db.select().from(settings).where(eq(settings.key, "enabled_product_types")).get();
  if (setting) {
    try {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through to default */ }
  }
  return ["unisex_tshirt", "hoodie", "mug_11oz", "poster", "tote_bag"];
}

async function rankProductTypesForNiche(nicheName: string, enabledTypes: string[]): Promise<string[]> {
  const perfData = await getProductTypePerformanceByNiche();
  const nichePerf = perfData.filter(
    (p) => p.nicheName.toLowerCase() === nicheName.toLowerCase() && p.totalOrders > 0,
  );

  if (nichePerf.length === 0) return enabledTypes;

  const perfMap = new Map(nichePerf.map((p) => [p.productType, p.totalOrders]));

  return [...enabledTypes].sort((a, b) => {
    const aScore = perfMap.get(a) ?? 0;
    const bScore = perfMap.get(b) ?? 0;
    return bScore - aScore;
  });
}

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped Printify product creation" };
  }

  // Get validated images
  const images = context.validatedImageIds.length > 0
    ? await context.db.select().from(generatedImages).where(inArray(generatedImages.id, context.validatedImageIds)).all()
    : await context.db.select().from(generatedImages).where(eq(generatedImages.status, "validated")).all();

  if (images.length === 0) {
    return { status: "completed", message: "No validated images for product creation" };
  }

  const shopId = process.env.PRINTIFY_SHOP_ID!;
  const allEnabledTypes = await getEnabledProductTypes(context.db);

  // Respect max_products_per_design setting
  const maxProductsSetting = await context.db.select().from(settings).where(eq(settings.key, "max_products_per_design")).get();
  const maxProductsPerDesign = Math.max(1, parseInt(maxProductsSetting?.value ?? "3") || 3);
  const enabledTypes = allEnabledTypes.slice(0, maxProductsPerDesign);

  // Tease pricing: one unpopular variant priced low so the listing displays "from $X"
  const teaseEnabledSetting = await context.db.select().from(settings).where(eq(settings.key, "tease_pricing_enabled")).get();
  const teaseDiscountSetting = await context.db.select().from(settings).where(eq(settings.key, "tease_pricing_discount_pct")).get();
  const teaseEnabled = teaseEnabledSetting?.value === "true";
  const teaseDiscountPct = teaseDiscountSetting ? parseFloat(teaseDiscountSetting.value) || 35 : 35;

  let created = 0;
  let failed = 0;

  for (const image of images) {
    // Get concept and niche info for the product title
    const concept = await context.db.select().from(designConcepts).where(eq(designConcepts.id, image.designConceptId)).get();
    const niche = concept ? await context.db.select().from(niches).where(eq(niches.id, concept.nicheId)).get() : null;

    // Upload design image to Printify
    let printifyImageId: string;
    try {
      const imageResponse = await fetch(image.storageUrl!);
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const base64 = imageBuffer.toString("base64");

      const uploaded = await printify.uploadImage(`${image.id}.png`, base64);
      printifyImageId = uploaded.id;
    } catch (error) {
      log("error", `[Step 06] Image upload to Printify failed for image ${image.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      failed++;
      continue;
    }

    // Rank product types by historical performance in this niche
    const rankedTypes = await rankProductTypesForNiche(niche?.name ?? "", enabledTypes);

    // Create each enabled product type (best sellers first)
    for (const productType of rankedTypes) {
      const config = getProductConfig(productType);
      if (!config) continue;

      // Idempotency: check if product already exists for this image + type
      const existing = await context.db
        .select()
        .from(printifyProducts)
        .where(eq(printifyProducts.generatedImageId, image.id))
        .all();

      if (existing.some((p) => p.productType === productType)) continue;

      try {
        // Get available variants for this blueprint
        const variantData = await printify.getVariants(config.blueprintId, config.printProviderId);
        const baseCost = getTypicalCost(productType);
        const targetMargin = getTargetMargin(productType, niche?.competitionLevel);
        const pricing = calculateDynamicPrice({
          productType,
          baseCost,
          nicheCompositeScore: niche?.compositeScore ?? undefined,
          competitionLevel: niche?.competitionLevel ?? undefined,
          trendDirection: niche?.trendDirection ?? undefined,
          marginPercent: targetMargin,
        });

        // Compute tease (hook) price for the loss-leader variant if enabled
        const tease = teaseEnabled
          ? calculateTeasePrice(pricing.retailPrice, baseCost, teaseDiscountPct)
          : null;

        const fullPriceCents = Math.round(pricing.retailPrice * 100);
        const hookPriceCents = tease ? Math.round(tease.hookPrice * 100) : fullPriceCents;

        const variantsRaw = variantData.variants.slice(0, 20);
        // Pick the last variant as the hook — usually the least common size/color
        // pairing (e.g., 5XL in an off-color), so most buyers pay full price.
        const hookIndex = variantsRaw.length - 1;
        const variants = variantsRaw.map((v, i) => ({
          id: v.id,
          price: tease && i === hookIndex ? hookPriceCents : fullPriceCents,
          is_enabled: true,
        }));

        if (tease) {
          log("info", `[Step 06] Tease pricing on ${productType}: from $${tease.hookPrice} (1 variant) / $${pricing.retailPrice} (${variantsRaw.length - 1} variants)`);
        }

        const displayName = getProductDisplayName(productType);
        const title = `${concept?.title ?? "Design"} ${displayName} | ${niche?.name ?? ""}`.trim();

        const product = await printify.createProduct(shopId, {
          title,
          description: concept?.description ?? "",
          blueprintId: config.blueprintId,
          printProviderId: config.printProviderId,
          variants,
          printAreas: [{
            variant_ids: variants.map((v) => v.id),
            placeholders: [{
              position: "front",
              images: [{
                id: printifyImageId,
                x: 0.5,
                y: 0.5,
                scale: 1,
                angle: 0,
              }],
            }],
          }],
        });

        const [dbProduct] = await context.db.insert(printifyProducts).values({
          designConceptId: image.designConceptId,
          generatedImageId: image.id,
          printifyProductId: product.id,
          printifyShopId: shopId,
          productType,
          blueprintId: config.blueprintId,
          printProviderId: config.printProviderId,
          title,
          description: concept?.description,
          baseCost,
          retailPrice: pricing.retailPrice,
          variants: JSON.stringify(variants),
          status: "created",
          printifyData: JSON.stringify(product),
          pipelineRunId: context.pipelineRunId,
        }).returning();

        context.createdProductIds.push(dbProduct.id);
        created++;
      } catch (error) {
        log("error", `[Step 06] Product creation failed for ${productType} (image ${image.id})`, {
          error: error instanceof Error ? error.message : String(error),
        });
        failed++;
        await context.db.insert(printifyProducts).values({
          designConceptId: image.designConceptId,
          generatedImageId: image.id,
          productType,
          title: concept?.title ?? "Failed Product",
          status: "failed",
          pipelineRunId: context.pipelineRunId,
        });
      }
    }
  }

  return {
    status: "completed",
    message: `Created ${created} products across ${enabledTypes.length} types, ${failed} failed`,
    data: { created, failed, images: images.length, productTypes: enabledTypes.length },
  };
}
