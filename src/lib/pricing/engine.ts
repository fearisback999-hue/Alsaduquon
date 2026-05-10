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

// Hook-variant strategy: "plausible but unpopular."
// We want a variant that looks like a real option — not 6XL Lime which
// screams bait. Think cream Youth-Small: a legit listing that just
// doesn't get picked often.
//
// Score = how good this size is as a hook. We AVOID the extremes (5XL+)
// because they look suspicious. Sweet spot is XS/S or youth sizes — real
// options that adults rarely buy.
const SIZE_HOOK_SCORE: Record<string, number> = {
  // Youth / baby sizes — perfect hooks, look legit
  YXS: 10, "YOUTH XS": 10,
  YS: 10, "YOUTH S": 10, "YOUTH SMALL": 10,
  YM: 9, "YOUTH M": 9, "YOUTH MEDIUM": 9,
  YL: 8, "YOUTH L": 8, "YOUTH LARGE": 8,
  YXL: 8, "YOUTH XL": 8,

  // Small adult sizes — plausible, low demand
  XXS: 7, "2XS": 7,
  XS: 6,
  S: 5, SMALL: 5,

  // Core sizes — never pick these, they're bestsellers
  M: 0, MEDIUM: 0,
  L: 0, LARGE: 0,
  XL: 1,

  // Big sizes — moderately unpopular but less suspicious than extremes
  "2XL": 3, XXL: 3,
  "3XL": 4, XXXL: 4,

  // Giant sizes — too obvious as bait, score them lower than small/youth
  "4XL": 2, XXXXL: 2,
  "5XL": 2, XXXXXL: 2,
  "6XL": 1,
};

// Hook color strategy: neutral/muted tones that look normal but don't sell.
// We AVOID neon/lime/coral — those scream "trick variant." Instead we
// prefer sand, cream, natural, ash — colors that exist on every catalog
// page but nobody actually clicks "add to cart" on.
const COLOR_HOOK_SCORE: Record<string, number> = {
  // Muted neutrals — the sweet spot: look totally normal, rarely bought
  SAND: 10, NATURAL: 10, CREAM: 10, TAN: 10, OATMEAL: 10,
  "HEATHER DUST": 9, "SOFT CREAM": 9, IVORY: 9, PEBBLE: 9,
  ASH: 8, "HEATHER PRISM": 8, "ICE GREY": 8, "ICE GRAY": 8,
  "SILVER": 7, STONE: 7, SLATE: 7,

  // Subtle pastels — believable but low-demand
  "LIGHT BLUE": 6, "BABY BLUE": 6, PEACH: 6,
  LAVENDER: 6, MAUVE: 6, DUSTY: 6,
  "HEATHER MAUVE": 6, "HEATHER ORCHID": 6,

  // Standard colors — moderate demand, avoid as hooks
  BROWN: 5, OLIVE: 5, "DARK HEATHER": 5,
  GREEN: 4, "FOREST GREEN": 4,
  PURPLE: 4, MAROON: 4, BURGUNDY: 4,
  ORANGE: 4, YELLOW: 4,
  RED: 3,
  BLUE: 3, "ROYAL BLUE": 3,
  NAVY: 2, "NAVY BLUE": 2,
  CHARCOAL: 2, GREY: 2, GRAY: 2,
  "HEATHER GREY": 1, "HEATHER GRAY": 1,

  // Top sellers — never pick these
  BLACK: 0, WHITE: 0,

  // Flashy colors — draws too much attention as bait, avoid
  LIME: 2, NEON: 2, "HOT PINK": 2, FUCHSIA: 2, CORAL: 2,
  PINK: 3, TEAL: 3, MINT: 3, MUSTARD: 3,
};

interface ParsedVariantTitle {
  size: string | null;
  color: string | null;
}

function parseVariantTitle(title: string): ParsedVariantTitle {
  // Common formats: "Black / 5XL", "Heather Royal / XL", "5XL / Lime",
  //                 "11oz / White", "Youth S / Sand", "5XL", "Lime"
  const parts = title.split("/").map((s) => s.trim());

  let size: string | null = null;
  let color: string | null = null;

  for (const part of parts) {
    const upper = part.toUpperCase();
    if (size == null && SIZE_HOOK_SCORE[upper] != null) {
      size = upper;
      continue;
    }
    if (color == null && SIZE_HOOK_SCORE[upper] == null) {
      color = upper;
    }
  }
  return { size, color };
}

function colorHookScore(color: string | null): number {
  if (!color) return 5;
  if (COLOR_HOOK_SCORE[color] != null) return COLOR_HOOK_SCORE[color];
  for (const [key, score] of Object.entries(COLOR_HOOK_SCORE)) {
    if (color.includes(key)) return score;
  }
  // Unknown color — probably a weird catalog name like "Heather Prism Peach",
  // which is exactly the kind of low-demand variant we want
  return 7;
}

/**
 * Picks a "plausible but unpopular" variant as the hook for from-pricing.
 *
 * Strategy: look like a real option nobody actually buys.
 *   - Prefer youth/XS/S sizes over giant 5XL+ (which look like bait)
 *   - Prefer muted neutrals (sand, cream, ash) over flashy colors
 *   - Never pick M/L/XL + Black/White (those are bestsellers)
 *   - If only one variant exists, return null (tease is a no-op)
 */
export function selectHookVariantIndex(
  variants: Array<{ id: number; title: string }>,
): number | null {
  if (variants.length <= 1) return null;

  let bestIdx = -1;
  let bestScore = -Infinity;

  for (let i = 0; i < variants.length; i++) {
    const { size, color } = parseVariantTitle(variants[i].title);

    const sizeScore = size && SIZE_HOOK_SCORE[size] != null ? SIZE_HOOK_SCORE[size] : 3;
    const clrScore = colorHookScore(color);

    // Both factors matter roughly equally — a cream M is as good as a
    // black Youth-S. Weight size slightly more since it's more predictive.
    const score = sizeScore * 12 + clrScore * 10;

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
