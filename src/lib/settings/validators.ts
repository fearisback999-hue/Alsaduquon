import { z } from "zod";

/**
 * Per-key validation schemas. These are checked server-side before any
 * setting is persisted, so a typo can't silently break the pipeline or
 * blow through budget controls.
 */
export const SETTING_VALIDATORS: Record<string, z.ZodType<unknown>> = {
  // Pipeline
  niche_score_threshold: z.coerce.number().min(0).max(10),
  concepts_per_niche: z.coerce.number().int().min(1).max(20),
  max_image_attempts: z.coerce.number().int().min(1).max(5),
  mockups_per_product: z.coerce.number().int().min(1).max(20),
  approval_batch_size: z.coerce.number().int().min(1).max(50),
  approval_mode: z.enum(["manual", "auto"]),
  training_wheels_enabled: z.enum(["true", "false"]),
  training_wheels_min_reviews: z.coerce.number().int().min(0).max(500),

  // Pricing
  base_price: z.coerce.number().min(1).max(500),
  margin_percent: z.coerce.number().min(0).max(500),
  // "true" = free-shipping model (fold merchant shipping into price & cost so
  // margins are real). "false" = buyer pays shipping separately (revenue-neutral).
  shipping_in_price: z.enum(["true", "false"]),
  max_title_length: z.coerce.number().int().min(20).max(140),
  max_tags: z.coerce.number().int().min(1).max(13),

  // Limits
  max_daily_cost: z.coerce.number().min(0.5).max(10000),
  max_daily_listings: z.coerce.number().int().min(1).max(500),
  max_products_per_design: z.coerce.number().int().min(1).max(16),
  pipeline_runs_per_day: z.coerce.number().int().min(1).max(4),

  // API
  image_generator: z.enum(["auto", "flux", "dalle"]),
  gpt_model: z.enum(["gpt-4o", "gpt-4o-mini", "gpt-4-turbo", "gpt-4", "gpt-4.1", "gpt-4.1-mini", "gpt-4.1-nano", "o3-mini"]),

  // Pipeline toggles
  seasonal_boost_enabled: z.enum(["true", "false"]),
  autopilot_enabled: z.enum(["true", "false"]),

  // Product types — JSON array of enabled product type strings
  enabled_product_types: z.string().refine((v) => {
    try {
      const parsed = JSON.parse(v);
      return Array.isArray(parsed) && parsed.every((x) => typeof x === "string");
    } catch {
      return false;
    }
  }, "Must be a JSON array of product type strings"),

  // Platforms — JSON array of enabled platform names
  enabled_platforms: z.string().refine((v) => {
    try {
      const parsed = JSON.parse(v);
      const valid = ["etsy", "shopify", "tiktok", "depop", "redbubble", "amazon"];
      return Array.isArray(parsed) && parsed.every((x: unknown) => typeof x === "string" && valid.includes(x));
    } catch { return false; }
  }, "Must be a JSON array of valid platform names"),

  // Tease pricing
  tease_pricing_enabled: z.enum(["true", "false"]),
  tease_pricing_discount_pct: z.coerce.number().min(0).max(95),
  tease_pricing_floor_mode: z.enum(["cost", "safe", "absolute"]),
  tease_pricing_absolute_floor: z.coerce.number().min(0).max(100),
  tease_companion_enabled: z.enum(["true", "false"]),
  tease_companion_product_type: z.enum(["postcard", "sticker", "greeting_card", "fridge_magnet", "baby_bodysuit"]),
  tease_companion_retail_price: z.coerce.number().min(1).max(100),

  // General
  annual_revenue_goal: z.coerce.number().min(1000).max(100_000_000),
  target_car_price: z.coerce.number().min(0).max(10_000_000),
};

export interface SettingValidationResult {
  ok: boolean;
  value?: unknown;
  error?: string;
}

export function validateSetting(key: string, value: string): SettingValidationResult {
  const validator = SETTING_VALIDATORS[key];
  if (!validator) {
    return { ok: false, error: `Unknown setting key: ${key}` };
  }

  const result = validator.safeParse(value);
  if (!result.success) {
    return { ok: false, error: result.error.issues.map((i) => i.message).join("; ") };
  }
  return { ok: true, value: result.data };
}
