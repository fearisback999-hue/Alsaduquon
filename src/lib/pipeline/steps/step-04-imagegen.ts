import type { PipelineContext, StepResult } from "../context";
import { designConcepts, generatedImages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateImage, analyzeImage } from "@/lib/ai/client";
import { ImageQualitySchema } from "@/lib/ai/schemas";
import { trackImageUsage, trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { persistImage } from "@/lib/images/storage";
import { DALLE_COST_HD, GPT4O_VISION_COST_ESTIMATE } from "@/lib/types";

const QUALITY_SYSTEM_PROMPT = "You are a print-on-demand quality inspector. Evaluate images for commercial viability on products like t-shirts, mugs, posters, and phone cases. Be strict — customers pay $25-45 for these products.";

function buildQualityPrompt(stylePrompt: string): string {
  return `Evaluate this AI-generated design for print-on-demand suitability.

Design intent: "${stylePrompt}"

Score each criterion 1-10:
1. COMPOSITION: Well-composed? Good use of space? Not too cluttered or too sparse?
2. TEXT_LEGIBILITY: If text is present, is it readable and correctly spelled? (10 if no text intended)
3. PRINT_SUITABILITY: Will this look good printed on products? Clean edges, appropriate contrast, no artifacts?
4. COMMERCIAL_APPEAL: Would a customer actually buy this at $25-45? Is it attractive and on-trend?
5. TECHNICAL_QUALITY: No blurriness, no distortion, no AI artifacts (extra fingers, garbled text, weird faces)?

Return JSON:
{
  "composition": <number>,
  "text_legibility": <number>,
  "print_suitability": <number>,
  "commercial_appeal": <number>,
  "technical_quality": <number>,
  "overall_score": <number 1-10>,
  "pass": <boolean>,
  "issues": ["<issue1>", "<issue2>"],
  "refinement_suggestion": "<how to improve the prompt if this fails>"
}

An image passes if overall_score >= 6 AND no individual score is below 4.`;
}

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped image generation" };
  }

  // Get moderated concepts ready for image generation
  const concepts = await context.db
    .select()
    .from(designConcepts)
    .where(eq(designConcepts.status, "moderated"))
    .all();

  if (concepts.length === 0) {
    return { status: "completed", message: "No concepts ready for image generation" };
  }

  let generated = 0;
  let failed = 0;
  let qualityRejected = 0;
  let totalCost = 0;

  for (const concept of concepts) {
    let imageGenerated = false;
    const maxAttempts = 3;
    let currentPrompt = concept.stylePrompt ?? concept.title;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Budget check: image generation + quality check
      await enforcebudget(DALLE_COST_HD + GPT4O_VISION_COST_ESTIMATE);

      try {
        const startTime = Date.now();

        const result = await generateImage(currentPrompt, {
          quality: "hd",
          size: "1024x1024",
        });

        const durationMs = Date.now() - startTime;

        // CRITICAL: Immediately persist to Vercel Blob — DALL-E URLs expire in ~1 hour
        const stored = await persistImage(
          result.url,
          `designs/${concept.nicheId}/${concept.id}-attempt${attempt}.png`,
        );

        // Track image generation cost
        await trackImageUsage({
          model: "dall-e-3",
          operation: "image_generation",
          quality: "hd",
          durationMs,
          pipelineRunId: context.pipelineRunId,
        });
        totalCost += DALLE_COST_HD;

        // QUALITY GATE: Evaluate the generated image with GPT-4o Vision
        const qualityCheck = await analyzeImage(
          stored.url,
          buildQualityPrompt(concept.stylePrompt ?? concept.title),
          {
            systemPrompt: QUALITY_SYSTEM_PROMPT,
            maxTokens: 400,
            temperature: 0.2,
            schema: ImageQualitySchema,
            schemaName: "image_quality",
          },
        );

        await trackTextUsage({
          model: qualityCheck.model,
          operation: "image_quality_check",
          inputTokens: qualityCheck.inputTokens,
          outputTokens: qualityCheck.outputTokens,
          pipelineRunId: context.pipelineRunId,
        });
        totalCost += GPT4O_VISION_COST_ESTIMATE;

        const quality = qualityCheck.parsed;

        if (quality && !quality.pass && attempt < maxAttempts) {
          // Quality failed — record this attempt and refine prompt for next try
          qualityRejected++;
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            revisedPrompt: result.revisedPrompt,
            originalUrl: result.url,
            storagePath: stored.pathname,
            storageUrl: stored.url,
            model: "dall-e-3",
            size: "1024x1024",
            quality: "hd",
            attempt,
            maxAttempts,
            status: "rejected",
            errorMessage: JSON.stringify({
              reason: "quality_gate",
              scores: quality,
            }),
            pipelineRunId: context.pipelineRunId,
          });

          // Refine prompt for next attempt
          const issues = quality.issues.join(", ");
          currentPrompt = `${concept.stylePrompt ?? concept.title}. IMPORTANT: Avoid these issues: ${issues}. ${quality.refinement_suggestion}`;
          continue;
        }

        // Quality passed (or parse failed — give benefit of the doubt)
        const [image] = await context.db.insert(generatedImages).values({
          designConceptId: concept.id,
          prompt: currentPrompt,
          revisedPrompt: result.revisedPrompt,
          originalUrl: result.url,
          storagePath: stored.pathname,
          storageUrl: stored.url,
          model: "dall-e-3",
          size: "1024x1024",
          quality: "hd",
          attempt,
          maxAttempts,
          status: "generated",
          pipelineRunId: context.pipelineRunId,
        }).returning();

        context.generatedImageIds.push(image.id);

        // Update concept status
        await context.db.update(designConcepts).set({ status: "generated" }).where(eq(designConcepts.id, concept.id));

        imageGenerated = true;
        generated++;
        break;
      } catch (error) {
        if (attempt === maxAttempts) {
          // Final attempt failed — record it
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            model: "dall-e-3",
            attempt,
            maxAttempts,
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            pipelineRunId: context.pipelineRunId,
          });

          await context.db.update(designConcepts).set({ status: "failed" }).where(eq(designConcepts.id, concept.id));
          failed++;
        }
        // Otherwise, retry
      }
    }

    // Rate limit: DALL-E 3 allows ~5 images/minute
    if (imageGenerated) {
      await new Promise((resolve) => setTimeout(resolve, 12000)); // 12s between images
    }
  }

  return {
    status: "completed",
    message: `Generated ${generated} images, ${failed} failed, ${qualityRejected} quality rejections (cost: $${totalCost.toFixed(2)})`,
    cost: totalCost,
    data: { generated, failed, qualityRejected, totalCost },
  };
}
