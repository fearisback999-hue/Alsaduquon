import type { PipelineContext, StepResult } from "../context";
import { generatedImages, designConcepts, niches, printifyProducts, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import * as printify from "@/lib/external/printify";
import { getProductConfig, getProductDisplayName, ALL_PRODUCT_TYPES } from "@/lib/printify/product-config";
import { calculateDynamicPrice, calculateTeasePrice, selectHookVariantIndex, getTypicalCost, getTypicalShipping, getTargetMargin } from "@/lib/pricing/engine";
import { isShippingIncludedInCost } from "@/lib/pricing/shipping";
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

  // Config guard: without these, every Printify call sends "Bearer undefined"
  // and gets a 401 that the per-product catch swallows — the step would report
  // "completed" with 0 products and the whole pipeline silently stalls. Fail
  // loudly and early instead.
  if (!process.env.PRINTIFY_API_TOKEN || !process.env.PRINTIFY_SHOP_ID) {
    const missing = [
      !process.env.PRINTIFY_API_TOKEN && "PRINTIFY_API_TOKEN",
      !process.env.PRINTIFY_SHOP_ID && "PRINTIFY_SHOP_ID",
    ].filter(Boolean).join(", ");
    return { status: "failed", message: `Printify not configured — missing ${missing}. Add it to .env.local and restart.` };
  }

  // Get validated images
  const images = context.validatedImageIds.length > 0
    ? await context.db.select().from(generatedImages).where(inArray(generatedImages.id, context.validatedImageIds)).all()
    : await context.db.select().from(generatedImages).where(eq(generatedImages.status, "validated")).all();

  if (images.length === 0) {
    return { status: "completed", message: "No validated images for product creation" };
  }

  const shopId = process.env.PRINTIFY_SHOP_ID;
  const allEnabledTypes = await getEnabledProductTypes(context.db);

  // Respect max_products_per_design setting
  const maxProductsSetting = await context.db.select().from(settings).where(eq(settings.key, "max_products_per_design")).get();
  const maxProductsPerDesign = Math.max(1, parseInt(maxProductsSetting?.value ?? "3") || 3);
  const enabledTypes = allEnabledTypes.slice(0, maxProductsPerDesign);

  // Tease pricing: one unpopular variant priced low so the listing displays "from $X"
  const [
    teaseEnabledSetting,
    teaseDiscountSetting,
    teaseFloorModeSetting,
    teaseAbsoluteFloorSetting,
    companionEnabledSetting,
    companionTypeSetting,
    companionPriceSetting,
  ] = await Promise.all([
    context.db.select().from(settings).where(eq(settings.key, "tease_pricing_enabled")).get(),
    context.db.select().from(settings).where(eq(settings.key, "tease_pricing_discount_pct")).get(),
    context.db.select().from(settings).where(eq(settings.key, "tease_pricing_floor_mode")).get(),
    context.db.select().from(settings).where(eq(settings.key, "tease_pricing_absolute_floor")).get(),
    context.db.select().from(settings).where(eq(settings.key, "tease_companion_enabled")).get(),
    context.db.select().from(settings).where(eq(settings.key, "tease_companion_product_type")).get(),
    context.db.select().from(settings).where(eq(settings.key, "tease_companion_retail_price")).get(),
  ]);
  const teaseEnabled = teaseEnabledSetting?.value === "true";
  // Free-shipping model (default): fold merchant-paid shipping into the cost
  // basis so prices actually net their target margin. Read once per run.
  const includeShipping = await isShippingIncludedInCost();
  const teaseDiscountPct = teaseDiscountSetting ? parseFloat(teaseDiscountSetting.value) || 70 : 70;
  const teaseFloorMode = (teaseFloorModeSetting?.value === "safe" || teaseFloorModeSetting?.value === "absolute"
    ? teaseFloorModeSetting.value
    : "cost") as "safe" | "cost" | "absolute";
  const teaseAbsoluteFloor = teaseAbsoluteFloorSetting ? parseFloat(teaseAbsoluteFloorSetting.value) || 5.99 : 5.99;
  const companionEnabled = companionEnabledSetting?.value === "true";
  const companionType = companionTypeSetting?.value || "postcard";
  const companionRetailPrice = companionPriceSetting ? parseFloat(companionPriceSetting.value) || 5.99 : 5.99;

  // If companion is enabled and the cheap type isn't already in the user's
  // enabled product types, slip it in as an extra (it doesn't count toward
  // max_products_per_design — companions are bait, not the main inventory).
  const typesToCreate = [...enabledTypes];
  if (companionEnabled && !typesToCreate.includes(companionType) && getProductConfig(companionType)) {
    typesToCreate.push(companionType);
  }

  let created = 0;
  let failed = 0;
  const errorSamples: string[] = [];
  const recordError = (msg: string) => { if (errorSamples.length < 5) errorSamples.push(msg); };

  for (const image of images) {
    // Get concept and niche info for the product title
    const concept = await context.db.select().from(designConcepts).where(eq(designConcepts.id, image.designConceptId)).get();
    const niche = concept ? await context.db.select().from(niches).where(eq(niches.id, concept.nicheId)).get() : null;

    // A validated image with no persisted blob URL is a data-integrity problem
    // (blob upload failed upstream but status was set to "validated"). Skip it
    // explicitly instead of letting fetch(undefined) throw a misleading
    // "upload failed" error.
    if (!image.storageUrl) {
      log("error", `[Step 06] Image ${image.id} is marked validated but has no storageUrl — skipping (blob persistence likely failed upstream)`);
      recordError(`image ${image.id}: missing storageUrl`);
      failed++;
      continue;
    }

    // Upload design image to Printify
    let printifyImageId: string;
    try {
      const imageResponse = await fetch(image.storageUrl);
      if (!imageResponse.ok) {
        throw new Error(`Image fetch returned ${imageResponse.status} for ${image.storageUrl}`);
      }
      const imageBuffer = Buffer.from(await imageResponse.arrayBuffer());
      const base64 = imageBuffer.toString("base64");

      const uploaded = await printify.uploadImage(`${image.id}.png`, base64);
      printifyImageId = uploaded.id;
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      log("error", `[Step 06] Image upload to Printify failed for image ${image.id}: ${msg}`, { error: msg });
      recordError(`image ${image.id} upload: ${msg}`);
      failed++;
      continue;
    }

    // Rank product types by historical performance in this niche.
    // Companion (if enabled) is appended last — it's bait, not main inventory.
    const rankedMain = await rankProductTypesForNiche(niche?.name ?? "", enabledTypes);
    const rankedTypes = companionEnabled && !rankedMain.includes(companionType) && getProductConfig(companionType)
      ? [...rankedMain, companionType]
      : rankedMain;

    // Create each enabled product type (best sellers first)
    for (const productType of rankedTypes) {
      const config = getProductConfig(productType);
      if (!config) continue;

      const isCompanion = companionEnabled && productType === companionType && !enabledTypes.includes(productType);

      // Idempotency: check if product already exists for this image + type.
      // A "creating" row with no printifyProductId is a stale reservation from
      // a prior crash — safe to reclaim. Any other match means the product was
      // already created or failed intentionally.
      const existing = await context.db
        .select()
        .from(printifyProducts)
        .where(eq(printifyProducts.generatedImageId, image.id))
        .all();

      const existingForType = existing.find((p) => p.productType === productType);
      if (existingForType) {
        if (existingForType.status === "creating" && !existingForType.printifyProductId) {
          await context.db.delete(printifyProducts).where(eq(printifyProducts.id, existingForType.id));
        } else {
          continue;
        }
      }

      try {
        const variantData = await printify.getVariants(config.blueprintId, config.printProviderId);
        const baseCost = getTypicalCost(productType);
        const shippingCost = includeShipping ? getTypicalShipping(productType) : 0;
        const landedCost = baseCost + shippingCost;
        const targetMargin = getTargetMargin(productType, niche?.competitionLevel);

        const pricing = isCompanion
          ? {
              retailPrice: companionRetailPrice,
              baseCost,
              shippingCost,
              landedCost,
              marginPercent: 0,
              demandMultiplier: 1,
              competitionAdjustment: 1,
              productTypeRange: { min: companionRetailPrice, max: companionRetailPrice },
            }
          : calculateDynamicPrice({
          productType,
          baseCost,
          shippingCost,
          nicheCompositeScore: niche?.compositeScore ?? undefined,
          competitionLevel: niche?.competitionLevel ?? undefined,
          trendDirection: niche?.trendDirection ?? undefined,
          marginPercent: targetMargin,
        });

        const variantsRaw = variantData.variants.slice(0, 20);

        const hookIndex = (teaseEnabled && !isCompanion) ? selectHookVariantIndex(variantsRaw) : null;
        // Floor the hook against LANDED cost (base + shipping) so a bait sale
        // never dips below true fee-inclusive break-even.
        const tease = teaseEnabled && !isCompanion && hookIndex != null
          ? calculateTeasePrice(pricing.retailPrice, landedCost, teaseDiscountPct, {
              floorMode: teaseFloorMode,
              absoluteFloor: teaseAbsoluteFloor,
            })
          : null;

        const fullPriceCents = Math.round(pricing.retailPrice * 100);
        const hookPriceCents = tease ? Math.round(tease.hookPrice * 100) : fullPriceCents;

        const variants = variantsRaw.map((v, i) => ({
          id: v.id,
          price: tease && i === hookIndex ? hookPriceCents : fullPriceCents,
          is_enabled: true,
        }));

        if (tease && hookIndex != null) {
          const hookVariant = variantsRaw[hookIndex];
          const lossNote = tease.belowCost
            ? ` ⚠️ BELOW LANDED COST ($${landedCost.toFixed(2)}) — every sale of this variant loses $${(landedCost - tease.hookPrice).toFixed(2)}, but it's selected to be the least likely to be picked`
            : "";
          log("info", `[Step 06] Tease on ${productType}: hook "${hookVariant.title}" at $${tease.hookPrice} (${tease.discountPct}% off, floor=${teaseFloorMode}), full $${pricing.retailPrice} on ${variantsRaw.length - 1} other variants${lossNote}`);
        }

        const displayName = getProductDisplayName(productType);
        const title = `${concept?.title ?? "Design"} ${displayName} | ${niche?.name ?? ""}`.trim();

        if (isCompanion) {
          log("info", `[Step 06] Companion bait: created ${displayName} for "${concept?.title ?? "design"}" at $${companionRetailPrice} (cost $${baseCost}, margin $${(companionRetailPrice - baseCost).toFixed(2)})`);
        }

        // Reserve the DB row BEFORE calling external API. If we crash between
        // Printify create and the update below, the "creating" row prevents a
        // duplicate on retry (the idempotency check above reclaims it).
        const [reservation] = await context.db.insert(printifyProducts).values({
          designConceptId: image.designConceptId,
          generatedImageId: image.id,
          productType,
          title,
          description: concept?.description,
          baseCost,
          retailPrice: pricing.retailPrice,
          status: "creating",
          pipelineRunId: context.pipelineRunId,
        }).returning();

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

        await context.db.update(printifyProducts).set({
          printifyProductId: product.id,
          printifyShopId: shopId,
          blueprintId: config.blueprintId,
          printProviderId: config.printProviderId,
          variants: JSON.stringify(variants),
          status: "created",
          printifyData: JSON.stringify(product),
          updatedAt: new Date().toISOString(),
        }).where(eq(printifyProducts.id, reservation.id));

        context.createdProductIds.push(reservation.id);
        created++;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        log("error", `[Step 06] Product creation failed for ${productType} (image ${image.id}): ${msg}`, { error: msg });
        recordError(`${productType} (image ${image.id}): ${msg}`);
        failed++;
        // Mark the pre-inserted reservation as failed if it exists
        const creatingRows = await context.db
          .select({ id: printifyProducts.id, productType: printifyProducts.productType, status: printifyProducts.status })
          .from(printifyProducts)
          .where(eq(printifyProducts.generatedImageId, image.id))
          .all();
        const reservationRow = creatingRows.find((r) => r.productType === productType && r.status === "creating");

        if (reservationRow) {
          await context.db.update(printifyProducts).set({
            status: "failed",
            updatedAt: new Date().toISOString(),
          }).where(eq(printifyProducts.id, reservationRow.id));
        } else {
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
  }

  // If we had images to work with but created nothing, the step failed —
  // surface it so the engine halts instead of marching to mockups/listings
  // with an empty product set.
  const errorSuffix = errorSamples.length > 0 ? ` — ERRORS: ${errorSamples.join("; ")}` : "";
  if (created === 0 && images.length > 0) {
    return {
      status: "failed",
      message: `Created 0 products from ${images.length} validated images (${failed} failed)${errorSuffix}`,
      data: { created, failed, images: images.length, productTypes: enabledTypes.length, errors: errorSamples },
    };
  }

  return {
    status: "completed",
    message: `Created ${created} products across ${enabledTypes.length} types, ${failed} failed${errorSuffix}`,
    data: { created, failed, images: images.length, productTypes: enabledTypes.length, errors: errorSamples },
  };
}
