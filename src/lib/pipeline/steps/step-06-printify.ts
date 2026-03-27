import type { PipelineContext, StepResult } from "../context";
import { generatedImages, designConcepts, niches, printifyProducts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { getProductConfig, PRODUCT_CONFIGS } from "@/lib/printify/product-config";
import { calculateRetailPrice } from "@/lib/etsy/pricing";
import type { ProductType } from "@/lib/types";

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
  const productTypes: ProductType[] = ["premium_tshirt", "hoodie", "blanket"];
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
      failed++;
      continue;
    }

    // Create each product type
    for (const productType of productTypes) {
      // Idempotency: check if product already exists
      const existing = await context.db
        .select()
        .from(printifyProducts)
        .where(eq(printifyProducts.generatedImageId, image.id))
        .all();

      if (existing.some((p) => p.productType === productType)) continue;

      const config = getProductConfig(productType);

      try {
        // Get available variants for this blueprint
        const variantData = await printify.getVariants(config.blueprintId, config.printProviderId);
        const variants = variantData.variants.slice(0, 20).map((v) => ({
          id: v.id,
          price: Math.round(calculateRetailPrice(15, 40, 25) * 100), // Price in cents
          is_enabled: true,
        }));

        const title = `${concept?.title ?? "Design"} ${productType === "premium_tshirt" ? "T-Shirt" : productType === "hoodie" ? "Hoodie" : "Blanket"} | ${niche?.name ?? ""}`.trim();

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
          baseCost: 15,
          retailPrice: calculateRetailPrice(15, 40, 25),
          variants: JSON.stringify(variants),
          status: "created",
          printifyData: JSON.stringify(product),
          pipelineRunId: context.pipelineRunId,
        }).returning();

        context.createdProductIds.push(dbProduct.id);
        created++;
      } catch (error) {
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
    message: `Created ${created} Printify products, ${failed} failed`,
    data: { created, failed, images: images.length },
  };
}
