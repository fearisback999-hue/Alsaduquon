import type { PipelineContext, StepResult } from "../context";
import { designConcepts, generatedImages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { generateImage } from "@/lib/ai/client";
import { trackImageUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { persistImage } from "@/lib/images/storage";
import { DALLE_COST_HD } from "@/lib/types";

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
  let totalCost = 0;

  for (const concept of concepts) {
    // Budget check before each image ($0.08 per HD image)
    await enforcebudget(DALLE_COST_HD);

    let imageGenerated = false;
    const maxAttempts = 3;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const startTime = Date.now();

        const result = await generateImage(concept.stylePrompt ?? concept.title, {
          quality: "hd",
          size: "1024x1024",
        });

        const durationMs = Date.now() - startTime;

        // CRITICAL: Immediately persist to Vercel Blob — DALL-E URLs expire in ~1 hour
        const stored = await persistImage(
          result.url,
          `designs/${concept.nicheId}/${concept.id}-attempt${attempt}.png`,
        );

        const [image] = await context.db.insert(generatedImages).values({
          designConceptId: concept.id,
          prompt: concept.stylePrompt ?? concept.title,
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

        // Track cost
        await trackImageUsage({
          model: "dall-e-3",
          operation: "image_generation",
          quality: "hd",
          durationMs,
          pipelineRunId: context.pipelineRunId,
          referenceId: image.id,
        });

        totalCost += DALLE_COST_HD;
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
            prompt: concept.stylePrompt ?? concept.title,
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
    message: `Generated ${generated} images, ${failed} failed (cost: $${totalCost.toFixed(2)})`,
    cost: totalCost,
    data: { generated, failed, totalCost },
  };
}
