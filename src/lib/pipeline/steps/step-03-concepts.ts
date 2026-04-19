import type { PipelineContext, StepResult } from "../context";
import { niches, designConcepts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { chatCompletion, StructuredOutputError } from "@/lib/ai/client";
import { DesignConceptsSchema } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { fullModeration } from "@/lib/ai/moderation";
import { enforcebudget } from "@/lib/cost/guard";
import { formatSalesContextForConcepts } from "@/lib/pipeline/sales-feedback";
import { formatSeasonalContext } from "@/lib/pipeline/seasonal-calendar";
import { log } from "@/lib/logger";
import { sanitizeForPrompt } from "@/lib/ai/sanitize";

const SYSTEM_PROMPT = `You are a creative director for a successful Etsy print-on-demand brand. You understand that different products require different design approaches — a mug design should be different from a t-shirt design. You create commercially viable designs across diverse artistic styles. Your designs sell because they match current market trends and target specific buyer personas. Avoid copyrighted characters, trademarked phrases, and political content.`;

const PRODUCT_TYPE_CONTEXT = `PRODUCT TYPES AND DESIGN REQUIREMENTS:
- T-shirts/Hoodies/Sweatshirts (4500x5400): Centered designs, bold graphics or text. Dark AND light garments available. Use "isolated on transparent background" for these.
- Mugs (4500x2100): Wide panoramic format. Wrap-around designs, scene illustrations, text banners. Full composition, no transparency needed.
- Posters/Canvas (4500x5400): Full artistic compositions. Detailed illustrations, watercolor, photography-style art. No transparency.
- Phone Cases (1800x3200): Tall narrow format. Patterns, bold graphics, geometric designs.
- Stickers (2400x2400): Square format. Cute, detailed illustrations with clear outlines.
- Tote Bags (4500x4500): Square format. Bold typography, simple illustrations.
- Blankets/Pillows: All-over patterns or large centered designs. Full compositions.`;

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped concept generation" };
  }

  // Get approved niches
  const approvedNiches = context.approvedNicheIds.length > 0
    ? await context.db.select().from(niches).where(inArray(niches.id, context.approvedNicheIds)).all()
    : await context.db.select().from(niches).where(eq(niches.status, "approved")).all();

  if (approvedNiches.length === 0) {
    return { status: "completed", message: "No approved niches for concept generation" };
  }

  let totalConcepts = 0;
  let moderationRejects = 0;

  for (const niche of approvedNiches) {
    await enforcebudget(0.05);
    const safeNicheName = sanitizeForPrompt(niche.name);

    // Get sales feedback for this niche
    const salesContext = await formatSalesContextForConcepts(niche.name);
    const seasonalContext = formatSeasonalContext();

    const prompt = `Generate 5 print-on-demand design concepts for the niche: "${safeNicheName}"

${salesContext}

${seasonalContext ? seasonalContext + "\n\n" : ""}${PRODUCT_TYPE_CONTEXT}

DIVERSITY REQUIREMENTS (MANDATORY):
- You MUST include at least 2 different design_type values from: "typography", "illustration", "hybrid", "pattern"
- You MUST include at least 2 different style approaches (e.g., minimalist, retro/vintage, watercolor, bold/modern, hand-drawn, geometric, boho, kawaii, grunge, Art Deco)
- You MUST target at least 2 different product categories with your style choices
- DO NOT default to "vector art on transparent background" for every design. Choose the style that best fits each concept AND the target product type.

For each concept, provide:
- title: Short catchy name (max 50 chars)
- description: What the design shows (1 sentence)
- style_prompt: Detailed DALL-E 3 prompt to generate this design. Be specific about artistic style, color palette, composition, and mood. Choose the style that best fits the concept AND the target product type. For apparel designs, specify "isolated on transparent background" ONLY when appropriate. For mugs/posters/canvas, create full compositions.
- target_audience: Who would buy this (1 sentence)
- design_type: "typography", "illustration", "hybrid", or "pattern"
- color_palette: Array of 3-5 hex colors
- recommended_products: Array of 1-3 product types this design would work best on (from: "unisex_tshirt", "hoodie", "mug_11oz", "poster", "phone_case", "sticker", "tote_bag", "canvas_print", "throw_pillow", "blanket")
- style_category: The artistic style used (e.g., "minimalist", "retro", "watercolor", "bold_modern", "hand_drawn", "geometric", "boho", "kawaii")

Return JSON:
{
  "concepts": [
    {
      "title": "...",
      "description": "...",
      "style_prompt": "...",
      "target_audience": "...",
      "design_type": "...",
      "color_palette": ["#...", "#..."],
      "recommended_products": ["...", "..."],
      "style_category": "..."
    }
  ]
}`;

    try {
      const result = await chatCompletion(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        maxTokens: 3000,
        temperature: 0.8,
        schema: DesignConceptsSchema,
        schemaName: "design_concepts",
      });

      await trackTextUsage({
        model: result.model,
        operation: "concept_generation",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        pipelineRunId: context.pipelineRunId,
      });

      const concepts = result.parsed?.concepts ?? [];

      // Soft diversity check — log warning but don't reject
      const designTypes = new Set(concepts.map((c) => c.design_type));
      if (designTypes.size < 2 && concepts.length >= 3) {
        log("warn", `[Step 03] Low diversity for niche "${niche.name}": all concepts are ${Array.from(designTypes)[0]}`);
      }

      for (let i = 0; i < concepts.length && i < 5; i++) {
        const concept = concepts[i];

        // EARLY MODERATION — before spending money on image generation
        const modResult = await fullModeration(`${concept.title} ${concept.description} ${concept.style_prompt}`);

        // Store enriched color palette with recommended products and style
        const enrichedPalette = JSON.stringify({
          colors: concept.color_palette,
          recommended_products: concept.recommended_products,
          style_category: concept.style_category,
        });

        if (!modResult.passed) {
          moderationRejects++;
          await context.db.insert(designConcepts).values({
            nicheId: niche.id,
            conceptNumber: i + 1,
            title: concept.title,
            description: concept.description,
            stylePrompt: concept.style_prompt,
            targetAudience: concept.target_audience,
            designType: concept.design_type,
            colorPalette: enrichedPalette,
            status: "rejected",
            moderationResult: JSON.stringify(modResult),
            pipelineRunId: context.pipelineRunId,
          });
          continue;
        }

        await context.db.insert(designConcepts).values({
          nicheId: niche.id,
          conceptNumber: i + 1,
          title: concept.title,
          description: concept.description,
          stylePrompt: concept.style_prompt,
          targetAudience: concept.target_audience,
          designType: concept.design_type,
          colorPalette: enrichedPalette,
          status: "moderated", // Passed moderation, ready for image gen
          moderationResult: JSON.stringify(modResult),
          pipelineRunId: context.pipelineRunId,
        });
        totalConcepts++;
      }
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        log("error", `[Step 03] Concept schema validation failed for niche "${niche.name}"`, {
          schemaName: error.schemaName,
          issues: error.zodIssues,
        });
      } else {
        log("error", `[Step 03] Concept generation failed for niche "${niche.name}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return {
    status: "completed",
    message: `Generated ${totalConcepts} concepts across ${approvedNiches.length} niches (${moderationRejects} rejected by moderation)`,
    data: { totalConcepts, moderationRejects, nichesProcessed: approvedNiches.length },
  };
}
