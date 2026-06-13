import type { PipelineContext, StepResult } from "../context";
import { printifyProducts, generatedImages, mockups } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { generateMockups, type MockupResult } from "@/lib/images/mockup-provider";
import * as placeit from "@/lib/external/placeit";
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

  // Surface (don't silently skip) when lifestyle mockups are disabled. Without
  // Placeit the step still works — Printify auto-generates flat product shots —
  // but the operator should know lifestyle shots (which convert 2-3x better)
  // aren't being produced.
  const placeitConfigured = placeit.isConfigured();
  if (!placeitConfigured) {
    log("info", "[Step 07] PLACEIT_API_TOKEN not set — generating Printify product shots only (no lifestyle mockups). Set PLACEIT_API_TOKEN to enable higher-converting lifestyle images.");
  }

  let totalMockups = 0;
  let lifestyleMockups = 0;
  let printifyMockups = 0;
  let failedProducts = 0;
  const errorSamples: string[] = [];
  const recordError = (msg: string) => { if (errorSamples.length < 5) errorSamples.push(msg); };

  for (const product of products) {
    if (!product.printifyProductId || !product.printifyShopId) {
      log("error", `[Step 07] Product ${product.id} is in 'created' status but missing Printify IDs — skipping (data integrity issue from Step 06)`);
      recordError(`product ${product.id}: missing Printify IDs`);
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
      const msg = error instanceof Error ? error.message : String(error);
      log("error", `[Step 07] Mockup generation failed for product ${product.id}: ${msg}`, { error: msg });
      recordError(`product ${product.id}: ${msg}`);
      failedProducts++;
    }
  }

  const errorSuffix = errorSamples.length > 0 ? ` — ERRORS: ${errorSamples.join("; ")}` : "";
  const placeitNote = placeitConfigured ? "" : " [lifestyle mockups disabled: PLACEIT_API_TOKEN not set]";

  // Every product produced zero mockups — listings would have no images. Fail
  // loudly so the run halts here instead of creating image-less Etsy drafts.
  if (totalMockups === 0 && products.length > 0) {
    return {
      status: "failed",
      message: `Generated 0 mockups from ${products.length} products (${failedProducts} failed)${placeitNote}${errorSuffix}`,
      data: { totalMockups, lifestyleMockups, printifyMockups, products: products.length, failedProducts, placeitConfigured, errors: errorSamples },
    };
  }

  return {
    status: "completed",
    message: `Generated ${totalMockups} mockups (${lifestyleMockups} lifestyle, ${printifyMockups} product shots) for ${products.length - failedProducts} products (${failedProducts} failed)${placeitNote}${errorSuffix}`,
    data: { totalMockups, lifestyleMockups, printifyMockups, products: products.length, failedProducts, placeitConfigured, errors: errorSamples },
  };
}
