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

  // Cheap bait products — dirt-cheap base costs, used as entry-point listings
  postcard:            { minPrice: 4, maxPrice: 9,   typicalCost: 1.5 },
  greeting_card:       { minPrice: 5, maxPrice: 10,  typicalCost: 3 },
  fridge_magnet:       { minPrice: 6, maxPrice: 12,  typicalCost: 3.5 },
  baby_bodysuit:       { minPrice: 16, maxPrice: 26, typicalCost: 9 },
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

export interface TeasePricingResult {
  hookPrice: number;
  fullPrice: number;
  discountPct: number;
  belowCost: boolean;
}

export type TeaseFloorMode = "safe" | "cost" | "absolute";

export interface TeasePricingOptions {
  floorMode?: TeaseFloorMode;
  // Used when floorMode === "safe" (default = 15% margin floor)
  safeMarginPct?: number;
  // Used when floorMode === "absolute" — a literal $ floor like 5.99
  absoluteFloor?: number;
}

/**
 * "From $X" pricing — a single low-priced variant catches eyes in search
 * results while every other variant stays at full price. The hook variant
 * is selected to be the largest size in the least popular color, so it's
 * rarely actually purchased.
 *
 * Floor modes:
 *   - "safe":     hook >= cost + safeMarginPct (no loss possible, but the
 *                 displayed 'from' price stays high — won't hit $5-7 zone)
 *   - "cost":     hook >= product cost (break-even when bought; this is
 *                 the recommended balance for most shops)
 *   - "absolute": hook >= absoluteFloor literal $ amount, ignoring cost.
 *                 Lets you hit a $5.99 'from' price even when product
 *                 cost is higher — every sale of this variant loses money,
 *                 but it's the eye-catching look real Etsy POD shops use.
 */
export function calculateTeasePrice(
  fullPrice: number,
  baseCost: number,
  discountPct: number,
  options: TeasePricingOptions = {},
): TeasePricingResult {
  const floorMode = options.floorMode ?? "cost";
  const safeMarginPct = options.safeMarginPct ?? 15;
  const absoluteFloor = options.absoluteFloor ?? 5.99;

  const safeDiscount = Math.max(0, Math.min(95, discountPct));
  const targetHook = fullPrice * (1 - safeDiscount / 100);

  let floor: number;
  if (floorMode === "safe") {
    floor = baseCost / (1 - safeMarginPct / 100);
  } else if (floorMode === "absolute") {
    floor = Math.max(0.99, absoluteFloor);
  } else {
    floor = baseCost; // break-even
  }

  const rawHook = Math.max(targetHook, floor);
  const hookPrice = Math.max(0.99, Math.floor(rawHook) + 0.99);
  const effectiveDiscount = fullPrice > 0
    ? Math.round(((fullPrice - hookPrice) / fullPrice) * 1000) / 10
    : 0;

  return {
    hookPrice: Math.round(hookPrice * 100) / 100,
    fullPrice,
    discountPct: effectiveDiscount,
    belowCost: hookPrice < baseCost,
  };
}

// Size hierarchy: higher rank = larger / less popular
const SIZE_RANK: Record<string, number> = {
  XXS: 0, "2XS": 0,
  XS: 1,
  S: 2, SMALL: 2,
  M: 3, MEDIUM: 3,
  L: 4, LARGE: 4,
  XL: 5,
  XXL: 6, "2XL": 6,
  XXXL: 7, "3XL": 7,
  "4XL": 8, XXXXL: 8,
  "5XL": 9, XXXXXL: 9,
  "6XL": 10,
};

// Higher number = LESS popular (so we want it as the hook)
// Common bestsellers: black, white, heather grey, navy
const COLOR_UNPOPULARITY: Record<string, number> = {
  BLACK: 1, WHITE: 1,
  "HEATHER GREY": 2, "HEATHER GRAY": 2, GREY: 2, GRAY: 2, CHARCOAL: 2,
  NAVY: 3, "NAVY BLUE": 3,
  RED: 4, "DARK HEATHER": 4,
  BLUE: 5, "ROYAL BLUE": 5, "ATHLETIC HEATHER": 5,
  GREEN: 6, "FOREST GREEN": 6, OLIVE: 6,
  PURPLE: 7, MAROON: 7, BURGUNDY: 7,
  ORANGE: 8, YELLOW: 8, BROWN: 8,
  PINK: 9, "HOT PINK": 9, FUCHSIA: 9,
  LIME: 10, NEON: 10, TEAL: 10, MINT: 10, CORAL: 10, MUSTARD: 10,
};

interface ParsedVariantTitle {
  size: string | null;
  color: string | null;
}

function parseVariantTitle(title: string): ParsedVariantTitle {
  // Common formats: "Black / 5XL", "Heather Royal / XL", "5XL / Lime",
  //                 "11oz / White", "5XL", "Lime"
  const parts = title.split("/").map((s) => s.trim());

  let size: string | null = null;
  let color: string | null = null;

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (size == null && SIZE_RANK[upper] != null) {
      size = upper;
      continue;
    }
    if (color == null && SIZE_RANK[upper] == null) {
      color = upper;
    }
  }
  return { size, color };
}

function colorUnpopularity(color: string | null): number {
  if (!color) return 5;
  // Exact match first
  if (COLOR_UNPOPULARITY[color] != null) return COLOR_UNPOPULARITY[color];
  // Partial: any keyword present
  for (const [key, score] of Object.entries(COLOR_UNPOPULARITY)) {
    if (color.includes(key)) return score;
  }
  // Unknown color = probably uncommon, score it high
  return 8;
}

/**
 * Picks the variant least likely to be a customer's first choice — the
 * "hook" variant for from-pricing. Strategy:
 *
 *   1. Prefer the largest size (5XL > 4XL > ... > S)
 *   2. Among the largest sizes, prefer the least popular color
 *      (lime/neon/coral over black/white)
 *   3. If no sizes parseable, just pick the most uncommon color
 *   4. If only one variant exists, return null — tease pricing is a no-op
 *
 * Returns the index of the chosen variant, or null if tease isn't viable.
 */
export function selectHookVariantIndex(
  variants: Array<{ id: number; title: string }>,
): number | null {
  if (variants.length <= 1) return null;

  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < variants.length; i++) {
    const { size, color } = parseVariantTitle(variants[i].title);

    let score = 0;
    if (size && SIZE_RANK[size] != null) {
      // Size is the dominant factor — multiply by 100 so it outweighs color
      score += SIZE_RANK[size] * 100;
    }
    score += colorUnpopularity(color);

    if (score > bestScore) {
      bestScore = score;
      bestIdx = i;
    }
  }

  return bestIdx >= 0 ? bestIdx : variants.length - 1;
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
