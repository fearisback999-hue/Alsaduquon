import type { PipelineContext, StepResult } from "../context";
import { generatedImages, designConcepts, niches, printifyProducts, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { getProductConfig, getProductDisplayName, ALL_PRODUCT_TYPES } from "@/lib/printify/product-config";
import { calculateDynamicPrice, getTypicalCost } from "@/lib/pricing/engine";

async function getEnabledProductTypes(db: PipelineContext["db"]): Promise<string[]> {
  const setting = await db.select().from(settings).where(eq(settings.key, "enabled_product_types")).get();
  if (setting) {
    try {
      const parsed = JSON.parse(setting.value);
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch { /* fall through to default */ }
  }
  // Default: top 5 best sellers
  return ["unisex_tshirt", "hoodie", "mug_11oz", "poster", "tote_bag"];
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
    } catch {
      failed++;
      continue;
    }

    // Create each enabled product type
    for (const productType of enabledTypes) {
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
        const pricing = calculateDynamicPrice({
          productType,
          baseCost,
          nicheCompositeScore: niche?.compositeScore ?? undefined,
          competitionLevel: niche?.competitionLevel ?? undefined,
          trendDirection: niche?.trendDirection ?? undefined,
          marginPercent: 40,
        });

        const variants = variantData.variants.slice(0, 20).map((v) => ({
          id: v.id,
          price: Math.round(pricing.retailPrice * 100), // Price in cents
          is_enabled: true,
        }));

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
      } catch {
        failed++;
        // Record failed product attempt
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
