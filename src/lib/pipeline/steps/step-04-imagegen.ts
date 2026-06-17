import type { PipelineContext, StepResult } from "../context";
import { designConcepts, generatedImages, settings } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";
import { analyzeImage } from "@/lib/ai/client";
import { generateImageFlux } from "@/lib/ai/providers";
import { ImageQualitySchema, type ImageQuality } from "@/lib/ai/schemas";
import { trackImageUsage, trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget, recordCost } from "@/lib/cost/guard";
import { uploadImageBuffer } from "@/lib/images/storage";
import { renderTextOnBackground, pickTextColor, extractDisplayText } from "@/lib/images/text-renderer";
import { log } from "@/lib/logger";
import { FLUX_PRO_ULTRA_COST, GPT4O_VISION_COST_ESTIMATE } from "@/lib/types";

const QUALITY_SYSTEM_PROMPT = "You are a print-on-demand quality inspector. Evaluate images for commercial viability on products like t-shirts, mugs, posters, and phone cases. Be strict — customers pay $25-45 for these products.";

/**
 * Returns the best Flux aspect ratio for a concept's recommended product mix.
 * Posters/canvas are art pieces — portrait. Apparel chest prints stay square.
 * Phone cases need tall narrow.
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

INTELLECTUAL-PROPERTY CHECK (critical — selling on Etsy):
Set "ip_risk" to true if the image contains ANY of the following, even subtly or stylized:
- A real brand name, logo, or wordmark (Nike swoosh, Disney, sports teams, car brands, etc.)
- A recognizable copyrighted character (cartoon, anime, movie, game, mascot)
- A real celebrity, musician, or public figure's likeness
- Copyrighted artwork or a distinctive trademarked visual style
- Recognizable lyrics, movie quotes, or slogans rendered as text
When in doubt, flag it. A false positive costs one design; a miss costs the whole shop.

Return JSON:
{
  "composition": <number>,
  "text_legibility": <number>,
  "print_suitability": <number>,
  "commercial_appeal": <number>,
  "technical_quality": <number>,
  "overall_score": <number 1-10>,
  "pass": <boolean>,
  "ip_risk": <boolean>,
  "ip_risk_reason": "<what was detected, or empty string if none>",
  "issues": ["<issue1>", "<issue2>"],
  "refinement_suggestion": "<how to improve the prompt if this fails>"
}

An image passes if overall_score >= 7 AND no individual score is below 5 AND ip_risk is false.`;
}

interface DesignConceptRow {
  id: string;
  nicheId: string;
  title: string;
  description: string | null;
  stylePrompt: string | null;
  designType: string | null;
  colorPalette: string | null;
}

interface RawCandidate {
  stored: { url: string; pathname: string };
  durationMs: number;
}

/**
 * Generates one image candidate (Flux or DALL-E) and uploads it to blob storage.
 * No quality gate, no text overlay — pure raw output.
 */
async function generateOneCandidate(
  concept: DesignConceptRow,
  prompt: string,
  attempt: number,
  candidateLetter: string,
  useFlux: boolean,
): Promise<RawCandidate> {
  const startTime = Date.now();
  let stored: { url: string; pathname: string };

  if (useFlux) {
    let recommendedProducts: string[] | null = null;
    try {
      const palette = JSON.parse(concept.colorPalette ?? "{}");
      recommendedProducts = palette.recommended_products ?? null;
    } catch { /* ignore */ }
    const aspectRatio = getAspectRatioForConcept(recommendedProducts);
    const result = await generateImageFlux(prompt, { aspectRatio, raw: true });
    stored = await uploadImageBuffer(
      result.buffer,
      `designs/${concept.nicheId}/${concept.id}-a${attempt}${candidateLetter}.png`,
    );
  } else {
    const { generateImage } = await import("@/lib/ai/client");
    const result = await generateImage(prompt, { quality: "hd", size: "1024x1024" });
    const { persistImage } = await import("@/lib/images/storage");
    stored = await persistImage(
      result.url,
      `designs/${concept.nicheId}/${concept.id}-a${attempt}${candidateLetter}.png`,
    );
  }

  return { stored, durationMs: Date.now() - startTime };
}

/**
 * Renders typography text on top of a generated image. Returns the new
 * stored URL/path on success, or null on failure (caller falls back to
 * the original raw image).
 */
async function applyTextOverlayIfNeeded(
  concept: DesignConceptRow,
  stored: { url: string; pathname: string },
  outputPath: string,
): Promise<{ url: string; pathname: string } | null> {
  if (concept.designType !== "typography" && concept.designType !== "hybrid") {
    return null;
  }
  const displayText = extractDisplayText(concept.title, concept.description ?? "");
  if (!displayText) return null;

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

    const newStored = await uploadImageBuffer(rendered.buffer, outputPath);
    log("info", `[Step 04] Text overlay applied: "${displayText}" on ${concept.title}`);
    return newStored;
  } catch (textErr) {
    log("warn", `[Step 04] Text overlay failed for ${concept.title}, using raw output`, {
      error: textErr instanceof Error ? textErr.message : String(textErr),
    });
    return null;
  }
}

function serializeQualityScores(quality: ImageQuality): string {
  return JSON.stringify({
    composition: quality.composition,
    text_legibility: quality.text_legibility,
    print_suitability: quality.print_suitability,
    commercial_appeal: quality.commercial_appeal,
    technical_quality: quality.technical_quality,
    overall_score: quality.overall_score,
    // Persist the IP verdict too — without it, an audit of why an image was
    // rejected (or how a bad one slipped through) has no record of the gate.
    ip_risk: quality.ip_risk,
    ip_risk_reason: quality.ip_risk_reason,
  });
}

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped image generation" };
  }

  // Pick up both fresh concepts ("moderated") AND previously-failed ones so
  // the pipeline self-heals after transient errors (rate limits, outages).
  // Failed concepts get up to MAX_RUN_RETRIES additional pipeline runs before
  // being permanently abandoned.
  const MAX_RUN_RETRIES = 3;

  const freshConcepts = await context.db
    .select()
    .from(designConcepts)
    .where(eq(designConcepts.status, "moderated"))
    .all();

  const retriableConcepts = await context.db
    .select()
    .from(designConcepts)
    .where(eq(designConcepts.status, "failed"))
    .all();

  // Only retry concepts that haven't exceeded the cross-run attempt cap.
  // We count how many failed image records exist per concept across all runs.
  const retrying: typeof freshConcepts = [];
  for (const c of retriableConcepts) {
    const failedImages = await context.db
      .select({ count: sql<number>`count(*)` })
      .from(generatedImages)
      .where(eq(generatedImages.designConceptId, c.id))
      .get();
    const totalRunAttempts = Math.ceil((failedImages?.count ?? 0) / 3); // 3 attempts per run
    if (totalRunAttempts < MAX_RUN_RETRIES) {
      retrying.push(c);
    }
  }

  if (retrying.length > 0) {
    log("info", `[Step 04] Retrying ${retrying.length} previously-failed concepts (self-heal)`);
    // Reset their status so downstream logic treats them the same as fresh
    await context.db
      .update(designConcepts)
      .set({ status: "moderated" })
      .where(inArray(designConcepts.id, retrying.map((c) => c.id)));
  }

  const concepts = [...freshConcepts, ...retrying];

  if (concepts.length === 0) {
    return { status: "completed", message: "No concepts ready for image generation" };
  }

  // Respect the image_generator setting: "flux" (default when Replicate is
  // configured), "dalle" (forces DALL-E even when Replicate is available),
  // or "auto" (prefer Flux, fall back to DALL-E).
  const genSetting = await context.db.select().from(settings).where(eq(settings.key, "image_generator")).get();
  const genPref = (genSetting?.value ?? "auto").toLowerCase();

  const hasFlux = !!process.env.REPLICATE_API_TOKEN;
  const hasDalle = !!process.env.OPENAI_API_KEY;
  const useFlux = genPref === "flux" ? hasFlux
    : genPref === "dalle" ? false
    : hasFlux; // "auto": prefer Flux

  const generatorName = useFlux ? "flux-1.1-pro-ultra" : "dall-e-3";
  const imageCost = useFlux ? FLUX_PRO_ULTRA_COST : 0.08;

  if (!useFlux && !hasDalle) {
    return { status: "failed", message: "Image generation not configured — set REPLICATE_API_TOKEN (Flux) or OPENAI_API_KEY (DALL-E)." };
  }

  log("info", `[Step 04] Using ${generatorName} (setting: ${genPref}, flux=${hasFlux ? "yes" : "no"}, dalle=${hasDalle ? "yes" : "no"})`);

  let generated = 0;
  let failed = 0;
  let qualityRejected = 0;
  let totalCost = 0;
  const errorSamples: string[] = [];
  const recordError = (msg: string) => { if (errorSamples.length < 5) errorSamples.push(msg); };

  for (const concept of concepts) {
    let imageGenerated = false;
    const maxAttempts = 3;
    let currentPrompt = concept.stylePrompt ?? concept.title;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      // Best-of-2 on attempt 1: generate 2 candidates in parallel and pick
      // the higher-scoring one. Doubles attempt-1 cost but dramatically
      // improves quality and often avoids retries (which cost the same).
      const candidateCount = attempt === 1 ? 2 : 1;
      const estimatedStepCost = (imageCost + GPT4O_VISION_COST_ESTIMATE) * candidateCount;
      await enforcebudget(estimatedStepCost);

      // Pre-record costs BEFORE external API calls so a crash between
      // spend and recording can't drift the budget ledger.
      const imageCategory = useFlux ? "replicate_image" : "openai_image";
      for (let ci = 0; ci < candidateCount; ci++) {
        await recordCost(imageCategory as Parameters<typeof recordCost>[0], imageCost, {
          description: `Image generation pre-record (${generatorName}, attempt ${attempt})`,
        });
        await recordCost("openai_text", GPT4O_VISION_COST_ESTIMATE, {
          description: `Quality check pre-record (attempt ${attempt})`,
        });
      }

      try {
        const candidates: RawCandidate[] = await Promise.all(
          Array.from({ length: candidateCount }, (_, i) =>
            generateOneCandidate(concept, currentPrompt, attempt, String.fromCharCode(97 + i), useFlux),
          ),
        );

        for (const c of candidates) {
          await trackImageUsage({
            model: generatorName,
            operation: "image_generation",
            quality: useFlux ? "flux" : "hd",
            durationMs: c.durationMs,
            pipelineRunId: context.pipelineRunId,
            costPreRecorded: true,
          });
          totalCost += imageCost;
        }

        // Score all candidates in parallel
        const scoreResults = await Promise.all(
          candidates.map((c) =>
            analyzeImage(
              c.stored.url,
              buildQualityPrompt(concept.stylePrompt ?? concept.title),
              {
                systemPrompt: QUALITY_SYSTEM_PROMPT,
                maxTokens: 400,
                temperature: 0.2,
                schema: ImageQualitySchema,
                schemaName: "image_quality",
              },
            ),
          ),
        );

        for (const score of scoreResults) {
          await trackTextUsage({
            model: score.model,
            operation: "image_quality_check",
            inputTokens: score.inputTokens,
            outputTokens: score.outputTokens,
            pipelineRunId: context.pipelineRunId,
            costPreRecorded: true,
          });
          totalCost += GPT4O_VISION_COST_ESTIMATE;
        }

        // Rank candidates: IP-safe & passing first, then by overall_score.
        // An ip_risk candidate is never preferred — a clean lower-scoring
        // design beats a high-scoring one that could get the shop banned.
        const effectivePass = (q: ImageQuality | null) => (q?.pass && !q.ip_risk ? 1 : 0);
        const ranked = candidates.map((c, i) => ({ ...c, quality: scoreResults[i].parsed }));
        ranked.sort((a, b) => {
          const aPass = effectivePass(a.quality);
          const bPass = effectivePass(b.quality);
          if (aPass !== bPass) return bPass - aPass;
          return (b.quality?.overall_score ?? 0) - (a.quality?.overall_score ?? 0);
        });

        const winner = ranked[0];
        const losers = ranked.slice(1);

        // Persist losers for analytics — they contributed to the cost
        for (const loser of losers) {
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            storagePath: loser.stored.pathname,
            storageUrl: loser.stored.url,
            model: generatorName,
            size: "1024x1024",
            quality: "hd",
            attempt,
            maxAttempts,
            status: "rejected",
            qualityScores: loser.quality ? serializeQualityScores(loser.quality) : null,
            errorMessage: JSON.stringify({
              reason: "best_of_n_loser",
              winnerScore: winner.quality?.overall_score,
              loserScore: loser.quality?.overall_score,
            }),
            pipelineRunId: context.pipelineRunId,
          });
        }

        // Vision scoring returned no parseable verdict (parsed: null — model
        // refused, malformed JSON, or API hiccup). We cannot certify this
        // image as quality-OK *or* IP-safe, and an unscreened image is exactly
        // as dangerous as a known-infringing one: publishing it could get the
        // shop banned. So it is NEVER a pass. Retry while attempts remain (it's
        // a scoring failure, not a design failure, so keep the prompt); abandon
        // the concept if we're out of attempts. This closes the fail-open where
        // a null verdict skipped both the IP and quality gates below.
        if (!winner.quality) {
          qualityRejected++;
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            storagePath: winner.stored.pathname,
            storageUrl: winner.stored.url,
            model: generatorName,
            size: "1024x1024",
            quality: "hd",
            attempt,
            maxAttempts,
            status: "rejected",
            qualityScores: null,
            errorMessage: JSON.stringify({ reason: "quality_unparseable" }),
            pipelineRunId: context.pipelineRunId,
          });
          log("warn", `[Step 04] Vision scoring returned no verdict for "${concept.title}" — cannot certify quality/IP, treating as reject`);

          if (attempt < maxAttempts) continue;
          await context.db.update(designConcepts).set({ status: "rejected" }).where(eq(designConcepts.id, concept.id));
          imageGenerated = false;
          break;
        }

        // IP risk is a hard reject — NEVER accept it, even on the final
        // attempt. A quality miss can ship as best-effort; an infringing
        // image cannot, because publishing it risks the entire shop.
        if (winner.quality.ip_risk) {
          qualityRejected++;
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            storagePath: winner.stored.pathname,
            storageUrl: winner.stored.url,
            model: generatorName,
            size: "1024x1024",
            quality: "hd",
            attempt,
            maxAttempts,
            status: "rejected",
            qualityScores: serializeQualityScores(winner.quality),
            errorMessage: JSON.stringify({ reason: "ip_risk", detail: winner.quality.ip_risk_reason }),
            pipelineRunId: context.pipelineRunId,
          });
          log("warn", `[Step 04] IP-rejected image for "${concept.title}": ${winner.quality.ip_risk_reason}`);

          if (attempt < maxAttempts) {
            currentPrompt = `${concept.stylePrompt ?? concept.title}. CRITICAL: produce 100% original artwork — absolutely NO brand logos, no copyrighted or recognizable characters, no celebrity likeness, no trademarked styles. Detected issue: ${winner.quality.ip_risk_reason}`;
            continue;
          }
          // Out of attempts and still infringing — abandon this concept entirely.
          await context.db.update(designConcepts).set({ status: "rejected" }).where(eq(designConcepts.id, concept.id));
          imageGenerated = false;
          break;
        }

        // Winner failed quality — refine and retry
        if (!winner.quality.pass && attempt < maxAttempts) {
          qualityRejected++;
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            storagePath: winner.stored.pathname,
            storageUrl: winner.stored.url,
            model: generatorName,
            size: "1024x1024",
            quality: "hd",
            attempt,
            maxAttempts,
            status: "rejected",
            qualityScores: serializeQualityScores(winner.quality),
            errorMessage: JSON.stringify({ reason: "quality_gate", scores: winner.quality }),
            pipelineRunId: context.pipelineRunId,
          });

          const issues = winner.quality.issues.join(", ");
          currentPrompt = `${concept.stylePrompt ?? concept.title}. IMPORTANT: Avoid these issues: ${issues}. ${winner.quality.refinement_suggestion}`;
          continue;
        }

        // Winner passed — apply text overlay if needed
        let finalStored = winner.stored;
        const overlayResult = await applyTextOverlayIfNeeded(
          concept,
          winner.stored,
          `designs/${concept.nicheId}/${concept.id}-a${attempt}-text.png`,
        );
        if (overlayResult) finalStored = overlayResult;

        const [image] = await context.db.insert(generatedImages).values({
          designConceptId: concept.id,
          prompt: currentPrompt,
          storagePath: finalStored.pathname,
          storageUrl: finalStored.url,
          model: generatorName,
          size: "1024x1024",
          quality: "hd",
          attempt,
          maxAttempts,
          status: "generated",
          qualityScores: serializeQualityScores(winner.quality),
          pipelineRunId: context.pipelineRunId,
        }).returning();

        context.generatedImageIds.push(image.id);
        await context.db.update(designConcepts).set({ status: "generated" }).where(eq(designConcepts.id, concept.id));

        imageGenerated = true;
        generated++;
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        // Log EVERY caught exception, not just the last attempt — a repeating
        // hard error (bad prompt, provider outage) was previously invisible
        // until attempt 3.
        log("warn", `[Step 04] Image attempt ${attempt}/${maxAttempts} failed for concept "${concept.title}": ${msg}`);
        if (attempt === maxAttempts) {
          recordError(`"${concept.title}": ${msg}`);
          await context.db.insert(generatedImages).values({
            designConceptId: concept.id,
            prompt: currentPrompt,
            model: generatorName,
            attempt,
            maxAttempts,
            status: "failed",
            errorMessage: msg,
            pipelineRunId: context.pipelineRunId,
          });

          await context.db.update(designConcepts).set({ status: "failed" }).where(eq(designConcepts.id, concept.id));
          failed++;
        }
      }
    }

    if (imageGenerated) {
      await new Promise((resolve) => setTimeout(resolve, useFlux ? 3000 : 12000));
    }
  }

  const errorSuffix = errorSamples.length > 0 ? ` — ERRORS: ${errorSamples.join("; ")}` : "";

  // Produced zero images from a non-empty concept set. If any were hard
  // failures (exceptions), fail the step so the pipeline halts visibly rather
  // than running mockups/listings with nothing. (All-quality-rejected with no
  // exceptions is also a dead end, so fail there too — nothing flows downstream.)
  if (generated === 0 && concepts.length > 0) {
    return {
      status: "failed",
      message: `Generated 0 images from ${concepts.length} concepts via ${generatorName} (${failed} hard failures, ${qualityRejected} quality/IP rejections)${errorSuffix}`,
      cost: totalCost,
      data: { generated, failed, qualityRejected, totalCost, generator: generatorName, errors: errorSamples },
    };
  }

  return {
    status: "completed",
    message: `Generated ${generated} images via ${generatorName} (best-of-2 first attempt), ${failed} failed, ${qualityRejected} quality rejections (cost: $${totalCost.toFixed(2)})${errorSuffix}`,
    cost: totalCost,
    data: { generated, failed, qualityRejected, totalCost, generator: generatorName, errors: errorSamples },
  };
}
