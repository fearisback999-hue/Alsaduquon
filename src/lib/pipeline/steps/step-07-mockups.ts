import type { PipelineContext, StepResult } from "../context";
import { printifyProducts, mockups } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { persistImage } from "@/lib/images/storage";

const MOCKUP_TYPES = ["front", "back", "side", "lifestyle", "closeup", "size_chart"] as const;

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped mockup generation" };
  }

  // Get created products
  const products = context.createdProductIds.length > 0
    ? await context.db.select().from(printifyProducts).where(inArray(printifyProducts.id, context.createdProductIds)).all()
    : await context.db.select().from(printifyProducts).where(eq(printifyProducts.status, "created")).all();

  if (products.length === 0) {
    return { status: "completed", message: "No products for mockup generation" };
  }

  let totalMockups = 0;
  let failedProducts = 0;

  for (const product of products) {
    if (!product.printifyProductId || !product.printifyShopId) {
      failedProducts++;
      continue;
    }

    try {
      const mockupData = await printify.getMockups(product.printifyShopId, product.printifyProductId);

      if (!mockupData.images || mockupData.images.length === 0) {
        failedProducts++;
        continue;
      }

      // Take up to 10 mockups
      const images = mockupData.images.slice(0, 10);

      for (let i = 0; i < images.length; i++) {
        const img = images[i];

        // Persist mockup to Vercel Blob
        let storedUrl: string;
        try {
          const stored = await persistImage(
            img.src,
            `mockups/${product.id}/mockup-${i + 1}.png`,
          );
          storedUrl = stored.url;
        } catch {
          storedUrl = img.src; // Fallback to Printify URL
        }

        // Assign mockup type based on position
        const mockupType = i < MOCKUP_TYPES.length ? MOCKUP_TYPES[i] : "front";

        await context.db.insert(mockups).values({
          printifyProductId: product.id,
          originalUrl: img.src,
          storageUrl: storedUrl,
          mockupType,
          sortOrder: i + 1,
          isPrimary: i === 0 || img.is_default,
          status: "stored",
        });

        totalMockups++;
      }
    } catch {
      failedProducts++;
    }
  }

  return {
    status: "completed",
    message: `Fetched ${totalMockups} mockups for ${products.length - failedProducts} products (${failedProducts} failed)`,
    data: { totalMockups, products: products.length, failedProducts },
  };
}
