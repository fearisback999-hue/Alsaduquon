import { db } from "@/lib/db";
import {
  designConcepts,
  generatedImages,
  printifyProducts,
  listings,
  orders,
  niches,
  listingMetrics,
} from "@/lib/db/schema";
import { eq, and, sql, gte, desc, inArray } from "drizzle-orm";
import { getProductConfig, getProductDisplayName } from "@/lib/printify/product-config";
import { calculateDynamicPrice, getTypicalCost } from "@/lib/pricing/engine";
import * as printify from "@/lib/external/printify";
import { log } from "@/lib/logger";

const MIN_ORDERS_TO_EXPAND = 2;
const LOOKBACK_DAYS = 45;

const EXPANSION_MAP: Record<string, string[]> = {
  unisex_tshirt: ["hoodie", "crewneck_sweatshirt", "mug_11oz", "sticker", "tote_bag"],
  hoodie: ["unisex_tshirt", "crewneck_sweatshirt", "mug_11oz"],
  mug_11oz: ["mug_15oz", "poster", "canvas_print"],
  poster: ["canvas_print", "throw_pillow", "blanket"],
  canvas_print: ["poster", "throw_pillow"],
  sticker: ["phone_case", "tote_bag", "mousepad"],
  tote_bag: ["mug_11oz", "sticker"],
  phone_case: ["sticker", "mousepad"],
  crewneck_sweatshirt: ["hoodie", "unisex_tshirt"],
  blanket: ["throw_pillow", "poster"],
  throw_pillow: ["blanket", "canvas_print"],
};

interface ExpansionResult {
  expanded: number;
  skipped: number;
  failed: number;
}

export async function expandWinningProducts(): Promise<ExpansionResult> {
  const result: ExpansionResult = { expanded: 0, skipped: 0, failed: 0 };
  const cutoff = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const shopId = process.env.PRINTIFY_SHOP_ID;
  if (!shopId) return result;

  const winners = await db
    .select({
      conceptId: designConcepts.id,
      conceptTitle: designConcepts.title,
      conceptDescription: designConcepts.description,
      nicheId: niches.id,
      nicheName: niches.name,
      nicheCompositeScore: niches.compositeScore,
      nicheCompetitionLevel: niches.competitionLevel,
      nicheTrendDirection: niches.trendDirection,
      productType: printifyProducts.productType,
      imageId: printifyProducts.generatedImageId,
      totalOrders: sql<number>`count(distinct ${orders.id})`,
      totalRevenue: sql<number>`coalesce(sum(${orders.revenue}), 0)`,
    })
    .from(designConcepts)
    .innerJoin(niches, eq(designConcepts.nicheId, niches.id))
    .innerJoin(printifyProducts, eq(printifyProducts.designConceptId, designConcepts.id))
    .innerJoin(listings, eq(listings.printifyProductId, printifyProducts.id))
    .innerJoin(orders, eq(orders.listingId, listings.id))
    .where(and(gte(orders.orderedAt, cutoff), eq(listings.status, "published")))
    .groupBy(designConcepts.id, printifyProducts.productType)
    .having(sql`count(distinct ${orders.id}) >= ${MIN_ORDERS_TO_EXPAND}`)
    .orderBy(desc(sql`count(distinct ${orders.id})`))
    .limit(20)
    .all();

  for (const winner of winners) {
    const expansionTargets = EXPANSION_MAP[winner.productType] ?? [];
    if (expansionTargets.length === 0) {
      result.skipped++;
      continue;
    }

    const existingProducts = await db
      .select({ productType: printifyProducts.productType })
      .from(printifyProducts)
      .where(eq(printifyProducts.designConceptId, winner.conceptId))
      .all();
    const existingTypes = new Set(existingProducts.map((p) => p.productType));

    const missingTypes = expansionTargets.filter((t) => !existingTypes.has(t));
    if (missingTypes.length === 0) {
      result.skipped++;
      continue;
    }

    const image = await db
      .select()
      .from(generatedImages)
      .where(eq(generatedImages.id, winner.imageId))
      .get();
    if (!image?.storageUrl) {
      result.skipped++;
      continue;
    }

    let printifyImageId: string;
    try {
      const imageResponse = await fetch(image.storageUrl);
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const base64 = imageBuffer.toString("base64");
      const uploaded = await printify.uploadImage(`${image.id}-expand.png`, base64);
      printifyImageId = uploaded.id;
    } catch (error) {
      log("error", `[winner-expansion] Image upload failed for concept ${winner.conceptId}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      result.failed++;
      continue;
    }

    for (const targetType of missingTypes.slice(0, 2)) {
      const config = getProductConfig(targetType);
      if (!config) continue;

      try {
        const variantData = await printify.getVariants(config.blueprintId, config.printProviderId);
        const baseCost = getTypicalCost(targetType);
        const pricing = calculateDynamicPrice({
          productType: targetType,
          baseCost,
          nicheCompositeScore: winner.nicheCompositeScore ?? undefined,
          competitionLevel: winner.nicheCompetitionLevel ?? undefined,
          trendDirection: winner.nicheTrendDirection ?? undefined,
          marginPercent: 40,
        });

        const variants = variantData.variants.slice(0, 20).map((v) => ({
          id: v.id,
          price: Math.round(pricing.retailPrice * 100),
          is_enabled: true,
        }));

        const displayName = getProductDisplayName(targetType);
        const title = `${winner.conceptTitle} ${displayName} | ${winner.nicheName}`.trim();

        const product = await printify.createProduct(shopId, {
          title,
          description: winner.conceptDescription ?? "",
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

        await db.insert(printifyProducts).values({
          designConceptId: winner.conceptId,
          generatedImageId: winner.imageId,
          printifyProductId: product.id,
          printifyShopId: shopId,
          productType: targetType,
          blueprintId: config.blueprintId,
          printProviderId: config.printProviderId,
          title,
          description: winner.conceptDescription,
          baseCost,
          retailPrice: pricing.retailPrice,
          variants: JSON.stringify(variants),
          status: "created",
          printifyData: JSON.stringify(product),
        });

        log("info", `[winner-expansion] Expanded "${winner.conceptTitle}" (${winner.totalOrders} orders) → ${displayName}`);
        result.expanded++;
      } catch (error) {
        log("error", `[winner-expansion] Failed to expand ${winner.conceptTitle} → ${targetType}`, {
          error: error instanceof Error ? error.message : String(error),
        });
        result.failed++;
      }
    }
  }

  return result;
}
