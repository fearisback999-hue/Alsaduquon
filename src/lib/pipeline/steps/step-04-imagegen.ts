import type { PipelineContext, StepResult } from "../context";
import { designConcepts, generatedImages } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { analyzeImage } from "@/lib/ai/client";
import { generateImageFlux } from "@/lib/ai/providers";
import { ImageQualitySchema } from "@/lib/ai/schemas";
import { trackImageUsage, trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { uploadImageBuffer } from "@/lib/images/storage";
import { renderTextOnBackground, pickTextColor, extractDisplayText } from "@/lib/images/text-renderer";
import { log } from "@/lib/logger";
import { FLUX_PRO_ULTRA_COST, GPT4O_VISION_COST_ESTIMATE } from "@/lib/types";

const QUALITY_SYSTEM_PROMPT = "You are a print-on-demand quality inspector. Evaluate images for commercial viability on products like t-shirts, mugs, posters, and phone cases. Be strict — customers pay $25-45 for these products.";

/**
 * Returns the best Flux aspect ratio for a concept's recommended product mix.
 * Posters/canvas are art pieces — portrait. Apparel chest prints stay square.
 * Phone cases need tall narrow. Mugs print as a wraparound but the customer
 * sees the front face, so square works there too.
 */
function getAspectRatioForConcept(recommendedProducts: string[] | null): "1:1" | "3:4" | "4:3" | "9:16" {
  if (!recommendedProducts || recommendedProducts.length === 0) return "1:1";
  const primary = recommendedProducts[0];
  if (primary === "poster" || primary === "canvas_print" || primary === "blanket" || primary === "throw_pillow") {
    return "3:4";
  }
  if (primary === "phone_case") return "9:16";
  return "1:1";
}

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

An image passes if overall_score >= 7 AND no individual score is below 5.`;
}

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped image generation" };
  }

  const concepts = await context.db
    .select()
    .from(designConcepts)
    .where(eq(designConcepts.status, "moderated"))
    .all();

  if (concepts.length === 0) {
    return { status: "completed", message: "No concepts ready for image generation" };
  }

  // Determine which image generator to use
  const useFlux = !!process.env.REPLICATE_API_TOKEN;
  const generatorName = useFlux ? "flux-1.1-pro-ultra" : "dall-e-3";
  const imageCost = useFlux ? FLUX_PRO_ULTRA_COST : 0.08;

  let generated = 0;
  let failed = 0;
  let qualityRejected = 0;
  let totalCost = 0;

  for (const concept of concepts) {
    let imageGenerated = false;
    const maxAttempts = 3;
    let currentPrompt = concept.stylePrompt ?? concept.title;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await enforcebudget(imageCost + GPT4O_VISION_COST_ESTIMATE);

      try {
        const startTime = Date.now();

        let stored: { url: string; pathname: string };

        if (useFlux) {
          // Flux 1.1 Pro Ultra — returns a buffer directly. Aspect ratio
          // is picked based on the concept's primary product type.
          let recommendedProducts: string[] | null = null;
          try {
            const palette = JSON.parse(concept.colorPalette ?? "{}");
            recommendedProducts = palette.recommended_products ?? null;
          } catch { /* ignore */ }
          const aspectRatio = getAspectRatioForConcept(recommendedProducts);
          const result = await generateImageFlux(currentPrompt, { aspectRatio, raw: true });
          stored = await uploadImageBuffer(
            result.buffer,
            `designs/${concept.nicheId}/${concept.id}-attempt${attempt}.png`,
          );
        } else {
          // Fallback to DALL-E 3
          const { generateImage } = await import("@/lib/ai/client");
          const result = await generateImage(currentPrompt, { quality: "hd", size: "1024x1024" });
          const { persistImage } = await import("@/lib/images/storage");
          stored = await persistImage(result.url, `designs/${concept.nicheId}/${concept.id}-attempt${attempt}.png`);
        }

        const durationMs = Date.now() - startTime;

        // TEXT OVERLAY: For typography/hybrid designs, render text programmatically
        if (concept.designType === "typography" || concept.designType === "hybrid") {
          const displayText = extractDisplayText(concept.title, concept.description ?? "");
          if (displayText) {
            try {
              const bgResponse = await fetch(stored.url);
              const bgBuffer = Buffer.from(await bgResponse.arrayBuffer());
              const colors = await pickTextColor(bgBuffer);

              let styleCategory = "default";
              try {
                const palette = JSON.parse(concept.colorPalette ?? "{}");
                styleCategory = palette.style_category ?? "default";
              } catch { /* ignore */ }

              const rendered = await renderTextOnBackground({
                text: displayText,
                backgroundBuffer: bgBuffer,
                fontFamily: styleCategory,
                color: colors.textColor,
                strokeColor: colors.strokeColor,
              });

              stored = await uploadImageBuffer(
                rendered.buffer,
                `designs/${concept.nicheId}/${concept.id}-attempt${attempt}-text.png`,
              );
              log("info", `[Step 04] Text overlay applied: "${displayText}" on ${concept.title}`);
            } catch (textErr) {
              log("warn", `[Step 04] Text overlay failed for ${concept.title}, using raw output`, {
                error: textErr instanceof Error ? textErr.message : String(textErr),
              });
            }
          }
        }

        await trackImageUsage({
          model: generatorName,
          operation: "image_generation",
          quality: useFlux ? "flux" : "hd",
          durationMs,
          pipelineRunId: context.pipelineRunId,
        });
        totalCost += imageCost;

        // QUALITY GATE: Evaluate with GPT-4o Vision
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
          qualityRejected++;
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            storagePath: stored.pathname,
            storageUrl: stored.url,
            model: generatorName,
            size: "1024x1024",
            quality: useFlux ? "hd" : "hd",
            attempt,
            maxAttempts,
            status: "rejected",
            qualityScores: JSON.stringify({
              composition: quality.composition,
              text_legibility: quality.text_legibility,
              print_suitability: quality.print_suitability,
              commercial_appeal: quality.commercial_appeal,
              technical_quality: quality.technical_quality,
              overall_score: quality.overall_score,
            }),
            errorMessage: JSON.stringify({
              reason: "quality_gate",
              scores: quality,
            }),
            pipelineRunId: context.pipelineRunId,
          });

          const issues = quality.issues.join(", ");
          currentPrompt = `${concept.stylePrompt ?? concept.title}. IMPORTANT: Avoid these issues: ${issues}. ${quality.refinement_suggestion}`;
          continue;
        }

        // Quality passed
        const [image] = await context.db.insert(generatedImages).values({
          designConceptId: concept.id,
          prompt: currentPrompt,
          storagePath: stored.pathname,
          storageUrl: stored.url,
          model: generatorName,
          size: "1024x1024",
          quality: "hd",
          attempt,
          maxAttempts,
          status: "generated",
          qualityScores: quality ? JSON.stringify({
            composition: quality.composition,
            text_legibility: quality.text_legibility,
            print_suitability: quality.print_suitability,
            commercial_appeal: quality.commercial_appeal,
            technical_quality: quality.technical_quality,
            overall_score: quality.overall_score,
          }) : null,
          pipelineRunId: context.pipelineRunId,
        }).returning();

        context.generatedImageIds.push(image.id);
        await context.db.update(designConcepts).set({ status: "generated" }).where(eq(designConcepts.id, concept.id));

        imageGenerated = true;
        generated++;
        break;
      } catch (error) {
        if (attempt === maxAttempts) {
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            model: generatorName,
            attempt,
            maxAttempts,
            status: "failed",
            errorMessage: error instanceof Error ? error.message : String(error),
            pipelineRunId: context.pipelineRunId,
          });

          await context.db.update(designConcepts).set({ status: "failed" }).where(eq(designConcepts.id, concept.id));
          failed++;
        }
      }
    }

    if (imageGenerated) {
      // Rate limit: Flux is faster than DALL-E but still throttle
      await new Promise((resolve) => setTimeout(resolve, useFlux ? 3000 : 12000));
    }
  }

  return {
    status: "completed",
    message: `Generated ${generated} images via ${generatorName}, ${failed} failed, ${qualityRejected} quality rejections (cost: $${totalCost.toFixed(2)})`,
    cost: totalCost,
    data: { generated, failed, qualityRejected, totalCost, generator: generatorName },
  };
}
