import type { PipelineContext, StepResult } from "../context";
import { printifyProducts, generatedImages, mockups } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { generateMockups, type MockupResult } from "@/lib/images/mockup-provider";
import { log } from "@/lib/logger";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped mockup generation" };
  }

  const products = context.createdProductIds.length > 0
    ? await context.db.select().from(printifyProducts).where(inArray(printifyProducts.id, context.createdProductIds)).all()
    : await context.db.select().from(printifyProducts).where(eq(printifyProducts.status, "created")).all();

  if (products.length === 0) {
    return { status: "completed", message: "No products for mockup generation" };
  }

  let totalMockups = 0;
  let lifestyleMockups = 0;
  let printifyMockups = 0;
  let failedProducts = 0;

  for (const product of products) {
    if (!product.printifyProductId || !product.printifyShopId) {
      failedProducts++;
      continue;
    }

    // Fetch the original design image URL for Placeit rendering
    const designImage = await context.db
      .select({ storageUrl: generatedImages.storageUrl })
      .from(generatedImages)
      .where(eq(generatedImages.id, product.generatedImageId))
      .get();

    const designImageUrl = designImage?.storageUrl;

    try {
      const mockupResults: MockupResult[] = await generateMockups({
        productId: product.id,
        productType: product.productType,
        printifyShopId: product.printifyShopId,
        printifyProductId: product.printifyProductId,
        designImageUrl: designImageUrl ?? "",
        maxLifestyle: 3,
        maxTotal: 8,
      });

      if (mockupResults.length === 0) {
        failedProducts++;
        continue;
      }

      for (const mockup of mockupResults) {
        await context.db.insert(mockups).values({
          printifyProductId: product.id,
          originalUrl: mockup.originalUrl,
          storageUrl: mockup.url,
          mockupType: mockup.mockupType,
          sortOrder: mockup.sortOrder,
          isPrimary: mockup.isPrimary,
          status: "stored",
        });

        totalMockups++;
        if (mockup.source === "placeit") lifestyleMockups++;
        else printifyMockups++;
      }
    } catch (error) {
      log("error", `[Step 07] Mockup generation failed for product ${product.id}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      failedProducts++;
    }
  }

  return {
    status: "completed",
    message: `Generated ${totalMockups} mockups (${lifestyleMockups} lifestyle, ${printifyMockups} product shots) for ${products.length - failedProducts} products (${failedProducts} failed)`,
    data: { totalMockups, lifestyleMockups, printifyMockups, products: products.length, failedProducts },
  };
}
