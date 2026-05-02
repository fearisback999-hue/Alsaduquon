import { ETSY_LISTING_FEE, ETSY_TRANSACTION_FEE_PERCENT } from "@/lib/types";

// Product-type specific pricing ranges based on Etsy POD market data
const PRODUCT_PRICING: Record<string, { minPrice: number; maxPrice: number; typicalCost: number }> = {
  // Apparel
  unisex_tshirt:       { minPrice: 22, maxPrice: 32, typicalCost: 12 },
  hoodie:              { minPrice: 38, maxPrice: 55, typicalCost: 22 },
  crewneck_sweatshirt: { minPrice: 35, maxPrice: 50, typicalCost: 20 },
  tank_top:            { minPrice: 20, maxPrice: 28, typicalCost: 10 },
  long_sleeve_tee:     { minPrice: 26, maxPrice: 36, typicalCost: 14 },
  vneck_tshirt:        { minPrice: 22, maxPrice: 30, typicalCost: 12 },

  // Drinkware
  mug_11oz:            { minPrice: 16, maxPrice: 24, typicalCost: 7 },
  mug_15oz:            { minPrice: 18, maxPrice: 26, typicalCost: 8 },

  // Bags
  tote_bag:            { minPrice: 18, maxPrice: 30, typicalCost: 12 },

  // Wall Art
  poster:              { minPrice: 15, maxPrice: 30, typicalCost: 8 },
  canvas_print:        { minPrice: 45, maxPrice: 80, typicalCost: 25 },

  // Accessories
  phone_case:          { minPrice: 20, maxPrice: 32, typicalCost: 10 },
  sticker:             { minPrice: 4, maxPrice: 10, typicalCost: 2 },
  mousepad:            { minPrice: 14, maxPrice: 22, typicalCost: 7 },

  // Home
  blanket:             { minPrice: 50, maxPrice: 85, typicalCost: 30 },
  throw_pillow:        { minPrice: 28, maxPrice: 45, typicalCost: 15 },
};

export interface PricingContext {
  productType: string;
  baseCost: number;
  nicheCompositeScore?: number;
  competitionLevel?: number;
  trendDirection?: string;
  marginPercent: number;
  minMarginPercent?: number;
}

export interface PricingResult {
  retailPrice: number;
  baseCost: number;
  marginPercent: number;
  demandMultiplier: number;
  competitionAdjustment: number;
  productTypeRange: { min: number; max: number };
}

/**
 * Dynamic pricing engine that considers product type, niche demand, and competition.
 * Returns a price within the product's market range, adjusted for demand signals.
 */
export function calculateDynamicPrice(ctx: PricingContext): PricingResult {
  const productPricing = PRODUCT_PRICING[ctx.productType];
  const minMargin = ctx.minMarginPercent ?? 30;

  // Start with cost-based pricing
  const costBasedPrice = ctx.baseCost / (1 - ctx.marginPercent / 100);

  // Demand multiplier from niche score (higher score = higher demand = premium pricing)
  let demandMultiplier = 1.0;
  if (ctx.nicheCompositeScore != null) {
    if (ctx.nicheCompositeScore >= 9.0) demandMultiplier = 1.20;       // Top-tier niche: +20%
    else if (ctx.nicheCompositeScore >= 8.0) demandMultiplier = 1.12;  // Strong niche: +12%
    else if (ctx.nicheCompositeScore >= 7.5) demandMultiplier = 1.05;  // Good niche: +5%
    // Below threshold niches shouldn't reach here, but no penalty
  }

  // Competition adjustment (lower competition = can charge more)
  let competitionAdjustment = 1.0;
  if (ctx.competitionLevel != null) {
    if (ctx.competitionLevel < 0.2) competitionAdjustment = 1.10;      // Very low competition: +10%
    else if (ctx.competitionLevel < 0.4) competitionAdjustment = 1.05; // Low competition: +5%
    else if (ctx.competitionLevel > 0.8) competitionAdjustment = 0.95; // High competition: -5%
  }

  // Trending boost
  if (ctx.trendDirection === "up") {
    demandMultiplier *= 1.05; // Trending up: extra +5%
  }

  // Calculate adjusted price
  let adjustedPrice = costBasedPrice * demandMultiplier * competitionAdjustment;

  // Clamp to product type range if available
  if (productPricing) {
    adjustedPrice = Math.max(productPricing.minPrice, Math.min(productPricing.maxPrice, adjustedPrice));
  }

  // Ensure minimum margin floor
  const minAllowedPrice = ctx.baseCost / (1 - minMargin / 100);
  adjustedPrice = Math.max(adjustedPrice, minAllowedPrice);

  // Round to .99 pricing (psychological pricing)
  const rounded = Math.floor(adjustedPrice) + 0.99;
  const retailPrice = Math.round(rounded * 100) / 100;

  // Recalculate actual margin
  const etsyFees = ETSY_LISTING_FEE + retailPrice * (ETSY_TRANSACTION_FEE_PERCENT / 100);
  const actualProfit = retailPrice - ctx.baseCost - etsyFees;
  const actualMargin = retailPrice > 0 ? (actualProfit / retailPrice) * 100 : 0;

  return {
    retailPrice,
    baseCost: ctx.baseCost,
    marginPercent: Math.round(actualMargin * 10) / 10,
    demandMultiplier: Math.round(demandMultiplier * 100) / 100,
    competitionAdjustment: Math.round(competitionAdjustment * 100) / 100,
    productTypeRange: productPricing
      ? { min: productPricing.minPrice, max: productPricing.maxPrice }
      : { min: 15, max: 50 },
  };
}

export function getTypicalCost(productType: string): number {
  return PRODUCT_PRICING[productType]?.typicalCost ?? 15;
}

// Premium products sustain higher margins (low price-elasticity, gift-friendly).
const PREMIUM_PRODUCTS = new Set([
  "canvas_print", "blanket", "throw_pillow", "hoodie", "crewneck_sweatshirt",
]);
// Commodity products compete on price; lower margin to stay listable.
const COMMODITY_PRODUCTS = new Set(["sticker", "mousepad", "poster"]);

/**
 * Returns the target margin percent for a product, adjusted for niche
 * competition. Replaces a single hardcoded 40% across all products.
 */
export function getTargetMargin(productType: string, competitionLevel?: number | null): number {
  let margin = 40;
  if (PREMIUM_PRODUCTS.has(productType)) margin = 50;
  else if (COMMODITY_PRODUCTS.has(productType)) margin = 35;

  if (competitionLevel != null) {
    if (competitionLevel < 0.3) margin += 5;
    else if (competitionLevel > 0.75) margin -= 3;
  }

  return Math.max(30, Math.min(55, margin));
}
