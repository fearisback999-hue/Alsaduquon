import type { PipelineContext, StepResult } from "../context";
import { niches, designConcepts } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { chatCompletion } from "@/lib/ai/client";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { fullModeration } from "@/lib/ai/moderation";
import { enforcebudget } from "@/lib/cost/guard";

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

    const prompt = `Generate 5 print-on-demand design concepts for the niche: "${niche.name}"

Each concept should be different in style. For each, provide:
- title: Short catchy name (max 50 chars)
- description: What the design shows (1 sentence)
- style_prompt: Detailed DALL-E 3 prompt to generate this design. Focus on clean, printable graphics. Specify: style, colors, composition, text if any. Always end with "isolated on transparent background, vector art style, high contrast, suitable for print-on-demand"
- target_audience: Who would buy this (1 sentence)
- design_type: "typography" (text-heavy), "illustration" (graphic-heavy), "hybrid" (text + graphic), or "pattern" (repeating pattern)
- color_palette: Array of 3-5 hex colors that work well on dark AND light garments

Return JSON:
{
  "concepts": [
    {
      "title": "...",
      "description": "...",
      "style_prompt": "...",
      "target_audience": "...",
      "design_type": "...",
      "color_palette": ["#...", "#..."]
    }
  ]
}`;

    const result = await chatCompletion(prompt, {
      systemPrompt: "You are a creative director for a print-on-demand brand. Generate designs that are trendy, commercially viable, and printable. Avoid copyrighted characters, trademarked phrases, and political content.",
      maxTokens: 3000,
      temperature: 0.8,
      jsonMode: true,
    });

    await trackTextUsage({
      model: result.model,
      operation: "concept_generation",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      pipelineRunId: context.pipelineRunId,
    });

    try {
      const parsed = JSON.parse(result.content);
      const concepts = parsed.concepts ?? [];

      for (let i = 0; i < concepts.length && i < 5; i++) {
        const concept = concepts[i];

        // EARLY MODERATION — before spending money on image generation
        const modResult = await fullModeration(`${concept.title} ${concept.description} ${concept.style_prompt}`);

        if (!modResult.passed) {
          moderationRejects++;
          await context.db.insert(designConcepts).values({
            nicheId: niche.id,
            conceptNumber: i + 1,
            title: concept.title,
            description: concept.description,
            stylePrompt: concept.style_prompt,
            targetAudience: concept.target_audience,
            designType: concept.design_type ?? "hybrid",
            colorPalette: JSON.stringify(concept.color_palette ?? []),
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
          designType: concept.design_type ?? "hybrid",
          colorPalette: JSON.stringify(concept.color_palette ?? []),
          status: "moderated", // Passed moderation, ready for image gen
          moderationResult: JSON.stringify(modResult),
          pipelineRunId: context.pipelineRunId,
        });
        totalConcepts++;
      }
    } catch {
      // Parse error — skip this niche's concepts
    }
  }

  return {
    status: "completed",
    message: `Generated ${totalConcepts} concepts across ${approvedNiches.length} niches (${moderationRejects} rejected by moderation)`,
    data: { totalConcepts, moderationRejects, nichesProcessed: approvedNiches.length },
  };
}
