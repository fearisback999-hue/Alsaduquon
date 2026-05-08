import { z } from "zod";

/**
 * Centralized Zod schemas for every AI JSON call in the pipeline.
 *
 * Notes for OpenAI strict structured outputs:
 * - Schema root must be an object (not a bare array).
 * - All properties are required (no `.optional()`).
 * - No `.strict()` needed — `zodResponseFormat` emits `additionalProperties: false`.
 */

// step-02-scoring.ts — pre-research call
export const NichePreResearchSchema = z.object({
  sales_velocity_assessment: z.enum(["low", "medium", "high"]),
  sales_velocity_reasoning: z.string(),
  seasonality_assessment: z.enum(["seasonal", "semi_seasonal", "evergreen"]),
  peak_months: z.array(z.number().int().min(1).max(12)),
  seasonality_reasoning: z.string(),
  trend_assessment: z.enum(["declining", "stable", "growing", "explosive"]),
  trend_reasoning: z.string(),
  saturation_assessment: z.enum(["low", "medium", "high", "oversaturated"]),
  overall_viability: z.string(),
});
export type NichePreResearch = z.infer<typeof NichePreResearchSchema>;

// step-02-scoring.ts — scoring call
export const NicheScoringSchema = z.object({
  search_volume_score: z.number().min(0).max(10),
  competition_score: z.number().min(0).max(10),
  sales_velocity_score: z.number().min(0).max(10),
  seasonality_score: z.number().min(0).max(10),
  trending_score: z.number().min(0).max(10),
  reasoning: z.string(),
});
export type NicheScoring = z.infer<typeof NicheScoringSchema>;

// step-03-concepts.ts — concept generation
const DesignConceptSchema = z.object({
  title: z.string(),
  description: z.string(),
  style_prompt: z.string(),
  target_audience: z.string(),
  design_type: z.enum(["typography", "illustration", "hybrid", "pattern"]),
  color_palette: z.array(z.string()),
  recommended_products: z.array(z.string()),
  style_category: z.string(),
});
export const DesignConceptsSchema = z.object({
  concepts: z.array(DesignConceptSchema),
});
export type DesignConcept = z.infer<typeof DesignConceptSchema>;
export type DesignConcepts = z.infer<typeof DesignConceptsSchema>;

// step-04-imagegen.ts — vision quality gate
export const ImageQualitySchema = z.object({
  composition: z.number().min(1).max(10),
  text_legibility: z.number().min(1).max(10),
  print_suitability: z.number().min(1).max(10),
  commercial_appeal: z.number().min(1).max(10),
  technical_quality: z.number().min(1).max(10),
  overall_score: z.number().min(1).max(10),
  pass: z.boolean(),
  issues: z.array(z.string()),
  refinement_suggestion: z.string(),
});
export type ImageQuality = z.infer<typeof ImageQualitySchema>;

// step-01-research.ts — AI keyword expansion for niche discovery
const ExpandedNicheSchema = z.object({
  keyword: z.string(),
  reasoning: z.string(),
});
export const NicheExpansionSchema = z.object({
  expanded_niches: z.array(ExpandedNicheSchema),
});
export type NicheExpansion = z.infer<typeof NicheExpansionSchema>;

// step-01-research.ts — micro-niche drilling (buyer-persona x occasion x style)
const MicroNicheItemSchema = z.object({
  keyword: z.string(),
  buyer_persona: z.string(),
  occasion: z.string(),
  style: z.string(),
  confidence: z.number().min(0).max(1),
});
export const MicroNicheDrillSchema = z.object({
  micro_niches: z.array(MicroNicheItemSchema).min(1).max(15),
});
export type MicroNicheDrill = z.infer<typeof MicroNicheDrillSchema>;

// lib/etsy/seo.ts — generateListingTags
// Wrapped in an envelope object: OpenAI strict mode requires an object root.
export const ListingTagsSchema = z.object({
  tags: z.array(z.string()),
});
export type ListingTags = z.infer<typeof ListingTagsSchema>;

// api/cron/optimize/route.ts — listing optimization
export const ListingOptimizationSchema = z.object({
  new_title: z.string(),
  new_tags: z.array(z.string()),
  changes_reasoning: z.string(),
});
export type ListingOptimization = z.infer<typeof ListingOptimizationSchema>;
