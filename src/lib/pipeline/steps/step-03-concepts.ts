import type { PipelineContext, StepResult } from "../context";
import { niches, designConcepts, printifyProducts, listings, settings } from "@/lib/db/schema";
import { eq, inArray, desc } from "drizzle-orm";
import { chatCompletion, StructuredOutputError } from "@/lib/ai/client";
import { DesignConceptsSchema, type DesignConcept } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { fullModeration } from "@/lib/ai/moderation";
import { enforcebudget } from "@/lib/cost/guard";
import { formatSalesContextForConcepts } from "@/lib/pipeline/sales-feedback";
import { formatSeasonalContext, getActiveSeasons, matchNicheToSeason } from "@/lib/pipeline/seasonal-calendar";
import { formatDesignPerformanceForConcepts, getNicheImageRejectionRate } from "@/lib/analytics/design-performance";
import { log } from "@/lib/logger";
import { sanitizeForPrompt } from "@/lib/ai/sanitize";

const NICHE_BATCH_SIZE = 3;

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

  const stepStartTime = Date.now();

  // Read GPT model setting so the dashboard control takes effect
  const gptModelSetting = await context.db.select().from(settings).where(eq(settings.key, "gpt_model")).get();
  const gptModel = gptModelSetting?.value || "gpt-4o";

  // Queue-aware capacity planning (auto-runs only — manual runs with specific
  // nicheIds always process exactly what the operator asked for).
  let nichesLimit = 0;
  if (context.approvedNicheIds.length === 0) {
    const TARGET_BUFFER_DAYS = 14;

    const [dailySetting, maxProdSetting] = await Promise.all([
      context.db.select().from(settings).where(eq(settings.key, "max_daily_listings")).get(),
      context.db.select().from(settings).where(eq(settings.key, "max_products_per_design")).get(),
    ]);
    const dailyLimit = Math.max(1, parseInt(dailySetting?.value ?? "5") || 5);
    const maxProductsPerDesign = Math.max(1, parseInt(maxProdSetting?.value ?? "3") || 3);
    const targetBuffer = dailyLimit * TARGET_BUFFER_DAYS;

    const [pendingProducts, pendingListings] = await Promise.all([
      context.db.select({ id: printifyProducts.id }).from(printifyProducts).where(eq(printifyProducts.status, "created")).all(),
      context.db.select({ id: listings.id }).from(listings).where(inArray(listings.status, ["draft", "pending_approval", "approved"])).all(),
    ]);
    const totalQueued = pendingProducts.length + pendingListings.length;

    log("info", `[Step 03] Queue depth: ${totalQueued}/${targetBuffer} products ready (${dailyLimit}/day × ${TARGET_BUFFER_DAYS}-day buffer)`);

    if (totalQueued >= targetBuffer) {
      return {
        status: "skipped",
        message: `Queue already has ${totalQueued} products (${Math.floor(totalQueued / dailyLimit)} days of content at ${dailyLimit}/day). Skipping concept generation.`,
      };
    }

    const productsNeeded = targetBuffer - totalQueued;
    // 5 concepts/niche (conservative baseline — peak seasons may produce 6-8)
    nichesLimit = Math.max(1, Math.ceil(Math.ceil(productsNeeded / maxProductsPerDesign) / 5));
    log("info", `[Step 03] Need ${productsNeeded} more products — processing up to ${nichesLimit} highest-scored niches`);
  }

  // Get approved niches — best-scored first; auto-runs capped to nichesLimit
  const approvedNiches = context.approvedNicheIds.length > 0
    ? await context.db.select().from(niches).where(inArray(niches.id, context.approvedNicheIds)).orderBy(desc(niches.compositeScore)).all()
    : await context.db.select().from(niches).where(eq(niches.status, "approved")).orderBy(desc(niches.compositeScore)).limit(nichesLimit).all();

  if (approvedNiches.length === 0) {
    return { status: "completed", message: "No approved niches for concept generation" };
  }

  let totalConcepts = 0;
  let moderationRejects = 0;
  let nichesSkippedForFailures = 0;

  const REJECTION_RATE_THRESHOLD = 0.7;
  const MIN_ATTEMPTS_FOR_SKIP = 6;

  // Filter out niches with high image rejection rates up front
  const viableNiches: typeof approvedNiches = [];
  for (const niche of approvedNiches) {
    const { rejectionRate, totalAttempts } = await getNicheImageRejectionRate(niche.id);
    if (totalAttempts >= MIN_ATTEMPTS_FOR_SKIP && rejectionRate >= REJECTION_RATE_THRESHOLD) {
      log("warn", `[Step 03] Skipping "${niche.name}" — ${(rejectionRate * 100).toFixed(0)}% image rejection rate over ${totalAttempts} recent attempts`);
      nichesSkippedForFailures++;
      continue;
    }
    viableNiches.push(niche);
  }

  // Determine seasonal boost — generate more concepts during peak windows
  const activeSeasons = getActiveSeasons();
  const peakSeasonActive = activeSeasons.some((s) => s.scoreBoost >= 1.0);

  async function processNiche(niche: typeof approvedNiches[0]): Promise<{ concepts: number; modRejects: number; error?: string }> {
    let nicheConceptCount = 0;
    let nicheModRejects = 0;

    try {
      await enforcebudget(0.05);
      const safeNicheName = sanitizeForPrompt(niche.name);

      const seasonMatch = matchNicheToSeason(niche.name, activeSeasons);
      const conceptCount = seasonMatch && seasonMatch.scoreBoost >= 1.0 ? 8 : peakSeasonActive ? 6 : 5;

      const [salesContext, designPerfContext] = await Promise.all([
        formatSalesContextForConcepts(niche.name),
        formatDesignPerformanceForConcepts(niche.name),
      ]);
      const seasonalContext = formatSeasonalContext();

      const prompt = `Generate ${conceptCount} print-on-demand design concepts for the niche: "${safeNicheName}"

${salesContext}
${designPerfContext}

${seasonalContext ? seasonalContext + "\n\n" : ""}${PRODUCT_TYPE_CONTEXT}

DIVERSITY REQUIREMENTS (MANDATORY):
- You MUST include at least 2 different design_type values from: "typography", "illustration", "hybrid", "pattern"
- You MUST include at least 2 different style approaches (e.g., minimalist, retro/vintage, watercolor, bold/modern, hand-drawn, geometric, boho, kawaii, grunge, Art Deco)
- You MUST target at least 2 different product categories with your style choices
- DO NOT default to "vector art on transparent background" for every design. Choose the style that best fits each concept AND the target product type.
${seasonMatch ? `\nSEASONAL BOOST: This niche aligns with "${seasonMatch.name}". Include ${Math.ceil(conceptCount / 3)} designs with seasonal/holiday themes that shoppers are actively searching for right now.` : ""}

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

      let concepts: DesignConcept[] = [];
      const MAX_DIVERSITY_RETRIES = 1;
      // gpt-4o with strict structured outputs occasionally returns a valid but
      // EMPTY {"concepts": []} — fast and without throwing. Retry those a couple
      // times with a firmer instruction before giving up, so one transient empty
      // completion doesn't stall the whole pipeline at step 3.
      const MAX_EMPTY_RETRIES = 2;
      let emptyRetries = 0;
      let lastCallMeta = "";

      for (let attempt = 0; attempt <= MAX_DIVERSITY_RETRIES; attempt++) {
        let attemptPrompt = prompt;
        if (emptyRetries > 0 && concepts.length === 0) {
          attemptPrompt = `${prompt}\n\nIMPORTANT: You MUST return ${conceptCount} fully-populated concept objects in the "concepts" array. Returning an empty array is not acceptable.`;
        } else if (attempt > 0) {
          attemptPrompt = `${prompt}\n\nIMPORTANT: Your previous attempt returned only "${Array.from(new Set(concepts.map((c) => c.design_type)))[0] ?? "one"}" design types. You MUST mix at least 2 different design_type values. Do not return all of one type.`;
        }

        log("info", `[Step 03] Calling AI for concept generation: niche="${niche.name}", attempt=${attempt + 1}, model=${gptModel}`);

        const callStart = Date.now();
        const result = await chatCompletion(attemptPrompt, {
          systemPrompt: SYSTEM_PROMPT,
          model: gptModel,
          maxTokens: 4000,
          temperature: 0.65,
          schema: DesignConceptsSchema,
          schemaName: "design_concepts",
        });
        const callDuration = Date.now() - callStart;

        const provider = result.model.startsWith("claude") ? "anthropic" : "openai";
        await trackTextUsage({
          model: result.model,
          operation: "concept_generation",
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          pipelineRunId: context.pipelineRunId,
          provider,
        });

        concepts = result.parsed?.concepts ?? [];
        lastCallMeta = `model: ${result.model}, ${callDuration}ms, tokens: ${result.inputTokens}/${result.outputTokens}`;
        log("info", `[Step 03] AI returned ${concepts.length} concepts for "${niche.name}" (${lastCallMeta})`);

        if (concepts.length === 0) {
          // outputTokens === 0 means the model returned nothing at all (request
          // likely rejected silently or refused); >0 means it ran but produced []
          if (emptyRetries < MAX_EMPTY_RETRIES) {
            emptyRetries++;
            log("warn", `[Step 03] Empty concepts for "${niche.name}" (${lastCallMeta}) — retry ${emptyRetries}/${MAX_EMPTY_RETRIES}`);
            attempt--; // don't let an empty response burn a diversity-retry slot
            continue;
          }
          log("error", `[Step 03] AI returned EMPTY concepts for "${niche.name}" after ${emptyRetries + 1} attempts (${lastCallMeta}) — likely API/model issue`);
          return { concepts: 0, modRejects: 0, error: `AI returned 0 concepts after ${emptyRetries + 1} attempts (${lastCallMeta})` };
        }

        const designTypes = new Set(concepts.map((c) => c.design_type));
        if (designTypes.size >= 2 || concepts.length < 3) break;

        if (attempt < MAX_DIVERSITY_RETRIES) {
          log("info", `[Step 03] Retrying "${niche.name}" — got ${designTypes.size} design type(s), need 2+`);
        } else {
          log("warn", `[Step 03] Diversity retry exhausted for "${niche.name}"; proceeding with ${designTypes.size} type(s)`);
        }
      }

      for (let i = 0; i < concepts.length && i < conceptCount; i++) {
        const concept = concepts[i];

        const modResult = await fullModeration(`${concept.title} ${concept.description} ${concept.style_prompt}`);

        const enrichedPalette = JSON.stringify({
          colors: concept.color_palette,
          recommended_products: concept.recommended_products,
          style_category: concept.style_category,
        });

        if (!modResult.passed) {
          const reasons: string[] = [];
          if (modResult.openaiResult.flagged) reasons.push(`openai: ${modResult.openaiResult.categories.join(", ")}`);
          if (!modResult.etsyResult.passed) reasons.push(`policy: ${modResult.etsyResult.violations.join("; ")}`);
          log("warn", `[Step 03] Concept rejected by moderation for "${niche.name}" / "${concept.title}": ${reasons.join(" | ")}`);
          nicheModRejects++;
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
          status: "moderated",
          moderationResult: JSON.stringify(modResult),
          pipelineRunId: context.pipelineRunId,
        });
        nicheConceptCount++;
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (error instanceof StructuredOutputError) {
        log("error", `[Step 03] Concept schema validation failed for niche "${niche.name}": ${msg}`, {
          schemaName: error.schemaName,
          issues: error.zodIssues,
        });
      } else {
        log("error", `[Step 03] Concept generation failed for niche "${niche.name}": ${msg}`, {
          error: msg,
          stack: error instanceof Error ? error.stack : undefined,
        });
      }
      return { concepts: 0, modRejects: 0, error: msg };
    }

    return { concepts: nicheConceptCount, modRejects: nicheModRejects };
  }

  // Process niches in parallel batches
  const nicheErrors: string[] = [];

  for (let i = 0; i < viableNiches.length; i += NICHE_BATCH_SIZE) {
    const batch = viableNiches.slice(i, i + NICHE_BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(processNiche));

    for (let j = 0; j < results.length; j++) {
      const result = results[j];
      if (result.status === "fulfilled") {
        totalConcepts += result.value.concepts;
        moderationRejects += result.value.modRejects;
        if (result.value.error) {
          nicheErrors.push(`"${batch[j].name}": ${result.value.error}`);
        }
      } else {
        const errMsg = result.reason instanceof Error ? result.reason.message : String(result.reason);
        nicheErrors.push(`"${batch[j].name}": ${errMsg}`);
        log("error", `[Step 03] Niche processing failed for "${batch[j].name}": ${errMsg}`, {
          error: errMsg,
          stack: result.reason instanceof Error ? result.reason.stack : undefined,
        });
      }
    }
  }

  const errorSuffix = nicheErrors.length > 0
    ? ` — ERRORS: ${nicheErrors.join("; ")}`
    : "";

  const stepDuration = Date.now() - stepStartTime;

  // If we had viable niches but produced zero concepts, FAIL the step so the
  // pipeline halts visibly instead of silently marching downstream with nothing.
  // Previously this required nicheErrors.length > 0, which let the "AI returns
  // empty array without throwing" case slip through as a silent success.
  if (totalConcepts === 0 && viableNiches.length > 0) {
    const diagnosis = nicheErrors.length > 0
      ? `Errors: ${nicheErrors.join("; ")}`
      : `No explicit errors caught — AI may have returned empty results. Step took ${stepDuration}ms (under 5s suggests API didn't execute properly).`;
    log("error", `[Step 03] ZERO concepts from ${viableNiches.length} viable niches in ${stepDuration}ms. ${diagnosis}`);
    return {
      status: "failed",
      message: `Concept generation produced 0 concepts from ${viableNiches.length} niches — ${nicheErrors.length > 0 ? nicheErrors.join("; ") : "AI returned empty results (check API key and model settings)"}`,
      data: { totalConcepts: 0, moderationRejects, nichesProcessed: viableNiches.length, nichesSkippedForFailures, errors: nicheErrors, durationMs: stepDuration },
    };
  }

  if (stepDuration < 5000 && viableNiches.length > 0) {
    log("warn", `[Step 03] Completed in ${stepDuration}ms — suspiciously fast for ${viableNiches.length} niches. AI calls may not be executing properly.`);
  }

  return {
    status: "completed",
    message: `Generated ${totalConcepts} concepts across ${viableNiches.length} niches (${moderationRejects} rejected by moderation, ${nichesSkippedForFailures} niches skipped for high image rejection rate)${errorSuffix}`,
    data: { totalConcepts, moderationRejects, nichesProcessed: viableNiches.length, nichesSkippedForFailures, errors: nicheErrors, durationMs: stepDuration },
  };
}
