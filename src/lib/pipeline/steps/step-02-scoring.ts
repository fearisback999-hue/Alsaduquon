import type { PipelineContext, StepResult } from "../context";
import { niches, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { chatCompletion, StructuredOutputError } from "@/lib/ai/client";
import { NichePreResearchSchema, NicheScoringSchema, type NichePreResearch } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { SCORE_THRESHOLD } from "@/lib/types";
import { formatSalesContextForScoring } from "@/lib/pipeline/sales-feedback";
import { getActiveSeasons, matchNicheToSeason } from "@/lib/pipeline/seasonal-calendar";
import { formatNicheVelocityForScoring } from "@/lib/analytics/design-performance";
import { getEffectiveWeights } from "@/lib/research/niche-learning";
import { computeVelocityScore } from "@/lib/research/demand-velocity";
import { getCrossPlatformSignals, computeTriangulationScore } from "@/lib/research/cross-platform-signals";
import { log } from "@/lib/logger";
import { sanitizeForPrompt } from "@/lib/ai/sanitize";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped scoring" };
  }

  // Get niches that need scoring
  const toScore = context.discoveredNicheIds.length > 0
    ? await context.db.select().from(niches).where(inArray(niches.id, context.discoveredNicheIds)).all()
    : await context.db.select().from(niches).where(eq(niches.status, "discovered")).all();

  if (toScore.length === 0) {
    return { status: "completed", message: "No niches to score" };
  }

  // Load sales context, velocity data, and dynamic scoring weights
  const salesContext = await formatSalesContextForScoring();
  const velocityContext = await formatNicheVelocityForScoring();
  const weights = await getEffectiveWeights();
  log("info", `[Step 02] Using ${weights.source} scoring weights`);

  // Check if seasonal boost is enabled
  const seasonalSetting = await context.db.select().from(settings).where(eq(settings.key, "seasonal_boost_enabled")).get();
  const seasonalBoostEnabled = seasonalSetting?.value !== "false"; // default true
  const activeSeasons = seasonalBoostEnabled ? getActiveSeasons() : [];

  // Read the score threshold from settings so the dashboard control actually
  // takes effect (it was previously ignored in favor of the hardcoded constant).
  const thresholdSetting = await context.db.select().from(settings).where(eq(settings.key, "niche_score_threshold")).get();
  const parsedThreshold = parseFloat(thresholdSetting?.value ?? "");
  const scoreThreshold = Number.isFinite(parsedThreshold) ? parsedThreshold : SCORE_THRESHOLD;

  let approved = 0;
  let rejected = 0;
  let totalCost = 0;

  // Track every scored niche so we can guarantee the pipeline always advances
  // with the BEST available niches even when a data-poor run scores everything
  // just under the threshold (the common case with no paid trend/Etsy APIs).
  const scoredNiches: { id: string; name: string; composite: number; passed: boolean }[] = [];

  for (const niche of toScore) {
    await enforcebudget(0.02); // Pre-research + scoring calls
    const safeNicheName = sanitizeForPrompt(niche.name);

    // Phase A: Pre-research — structured market assessment
    const preResearchPrompt = `Provide a brief market assessment for this print-on-demand niche.

Niche: "${safeNicheName}"

Available data:
- Search volume: ${niche.searchVolume ?? "not available"}
- Competition level: ${niche.competitionLevel ?? "not available"}
- Trend direction: ${niche.trendDirection ?? "not available"}

${salesContext}

Based on the data above and your knowledge of the print-on-demand market, assess:
1. SALES VELOCITY: How fast would items in this niche likely sell? Consider the niche category, audience size, and comparable niches above.
2. SEASONALITY: Is this niche seasonal (holiday, summer, back-to-school) or evergreen? Which months would see peak demand?
3. TREND TRAJECTORY: Is this niche growing, stable, or declining? Is it a fad or lasting trend?
4. MARKET SATURATION: How crowded is this niche on Etsy specifically for POD products?

Return JSON:
{
  "sales_velocity_assessment": "low|medium|high",
  "sales_velocity_reasoning": "<1 sentence>",
  "seasonality_assessment": "seasonal|semi_seasonal|evergreen",
  "peak_months": [1,2,3],
  "seasonality_reasoning": "<1 sentence>",
  "trend_assessment": "declining|stable|growing|explosive",
  "trend_reasoning": "<1 sentence>",
  "saturation_assessment": "low|medium|high|oversaturated",
  "overall_viability": "<2 sentences>"
}`;

    let research: NichePreResearch | null = null;
    try {
      const preResearch = await chatCompletion(preResearchPrompt, {
        systemPrompt: "You are a POD market research analyst. Provide concise, data-driven market assessments.",
        maxTokens: 500,
        temperature: 0.2,
        schema: NichePreResearchSchema,
        schemaName: "niche_pre_research",
      });

      totalCost += await trackTextUsage({
        model: preResearch.model,
        operation: "niche_pre_research",
        inputTokens: preResearch.inputTokens,
        outputTokens: preResearch.outputTokens,
        pipelineRunId: context.pipelineRunId,
      });

      research = preResearch.parsed;
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        log("error", `[Step 02] Pre-research schema validation failed for niche "${niche.name}"`, {
          schemaName: error.schemaName,
          issues: error.zodIssues,
        });
      } else {
        throw error;
      }
    }

    // Compute demand velocity and cross-platform triangulation for this niche
    let velocityScore = niche.velocityScore ?? 0;
    let triangulationScore = niche.triangulationScore ?? 0;
    let platformsPresent = niche.platformsPresent ?? 0;

    try {
      const velocity = await computeVelocityScore(niche.id);
      velocityScore = velocity.score;
    } catch { /* velocity is optional enrichment */ }

    try {
      const signals = await getCrossPlatformSignals(niche.name);
      const tri = computeTriangulationScore(signals);
      triangulationScore = tri.score;
      platformsPresent = tri.platforms;

      await context.db.update(niches).set({
        triangulationScore: tri.score,
        platformsPresent: tri.platforms,
        crossPlatformData: JSON.stringify(signals),
        updatedAt: new Date().toISOString(),
      }).where(eq(niches.id, niche.id));
    } catch { /* triangulation is optional enrichment */ }

    // Phase B: Scoring with enriched context
    const scoringPrompt = `Analyze this print-on-demand niche and rate each metric on a scale of 0-10.

Niche: "${safeNicheName}"

HARD DATA:
- Search volume: ${niche.searchVolume ?? "not available"} monthly searches
- Competition level: ${niche.competitionLevel ?? "not available"} (0-1 scale, 1 = highest)
- Trend direction from APIs: ${niche.trendDirection ?? "not available"}
- Demand velocity score: ${velocityScore}/10 (week-over-week growth tracking)
- Cross-platform triangulation: ${triangulationScore}/100 (present on ${platformsPresent} platforms)

PRE-RESEARCH ANALYSIS:
- Sales velocity assessment: ${research?.sales_velocity_assessment ?? "unknown"} — ${research?.sales_velocity_reasoning ?? "no data"}
- Seasonality: ${research?.seasonality_assessment ?? "unknown"} (peak months: ${research?.peak_months.join(", ") ?? "N/A"}) — ${research?.seasonality_reasoning ?? "no data"}
- Trend trajectory: ${research?.trend_assessment ?? "unknown"} — ${research?.trend_reasoning ?? "no data"}
- Market saturation: ${research?.saturation_assessment ?? "unknown"}
- Overall viability: ${research?.overall_viability ?? "no data"}

OUR STORE'S HISTORICAL PERFORMANCE:
${salesContext}
${velocityContext}

Rate these metrics (0-10 scale, 10 = best for a POD seller):
1. search_volume_score: How high is demand? Use the search volume number if available. (weight: ${weights.searchVolume})
2. competition_score: How LOW is competition? 10 = wide open market. Consider saturation assessment. (weight: ${weights.competition})
3. sales_velocity_score: How fast will items sell? Use the velocity assessment and comparable niche data. (weight: ${weights.salesVelocity})
4. seasonality_score: How evergreen is this? 10 = year-round demand, 3 = single-month spike. (weight: ${weights.seasonality})
5. trending_score: Growth trajectory? 10 = explosive growth, 5 = stable, 2 = declining. (weight: ${weights.trending})

CALIBRATION: A score of 7+ should be reserved for niches with strong evidence. Default to 5 when uncertain. Only score above 8 if hard data supports it.

Return JSON only:
{
  "search_volume_score": <number>,
  "competition_score": <number>,
  "sales_velocity_score": <number>,
  "seasonality_score": <number>,
  "trending_score": <number>,
  "reasoning": "<2-3 sentences explaining the most important factors>"
}`;

    try {
      const result = await chatCompletion(scoringPrompt, {
        systemPrompt: "You are a POD market analyst. Score niches accurately based on real market knowledge. Be critical — most niches are mediocre.",
        maxTokens: 400,
        temperature: 0.3,
        schema: NicheScoringSchema,
        schemaName: "niche_scoring",
      });

      totalCost += await trackTextUsage({
        model: result.model,
        operation: "niche_scoring",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        pipelineRunId: context.pipelineRunId,
      });

      const scores = result.parsed!;
      let composite =
        scores.search_volume_score * weights.searchVolume +
        scores.competition_score * weights.competition +
        scores.sales_velocity_score * weights.salesVelocity +
        scores.seasonality_score * weights.seasonality +
        scores.trending_score * weights.trending +
        velocityScore * weights.velocity +
        (triangulationScore / 10) * weights.triangulation;

      // Apply seasonal boost if niche matches an active season
      let seasonalMatch: string | null = null;
      if (activeSeasons.length > 0) {
        const match = matchNicheToSeason(niche.name, activeSeasons);
        if (match) {
          composite += match.scoreBoost;
          seasonalMatch = match.name;
        }
      }

      const roundedComposite = Math.round(composite * 100) / 100;
      const passed = composite >= scoreThreshold;
      scoredNiches.push({ id: niche.id, name: niche.name, composite: roundedComposite, passed });

      await context.db.update(niches).set({
        compositeScore: roundedComposite,
        scoreBreakdown: JSON.stringify({ ...scores, pre_research: research, seasonal_boost: seasonalMatch }),
        passedThreshold: passed,
        salesVelocity: scores.sales_velocity_score,
        seasonalityScore: scores.seasonality_score,
        trendingScore: scores.trending_score,
        status: passed ? "approved" : "rejected",
        updatedAt: new Date().toISOString(),
      }).where(eq(niches.id, niche.id));

      if (passed) {
        context.approvedNicheIds.push(niche.id);
        approved++;
      } else {
        rejected++;
      }
    } catch (error) {
      if (error instanceof StructuredOutputError) {
        log("error", `[Step 02] Scoring schema validation failed for niche "${niche.name}"`, {
          schemaName: error.schemaName,
          issues: error.zodIssues,
        });
      } else {
        log("error", `[Step 02] Scoring failed for niche "${niche.name}"`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
      await context.db.update(niches).set({
        status: "rejected",
        updatedAt: new Date().toISOString(),
      }).where(eq(niches.id, niche.id));
      rejected++;
    }
  }

  // ── Guaranteed minimum: promote the best-available niches ──
  // Data-poor runs (no paid trend/Etsy APIs) make the AI cluster scores around
  // 5, just under a 7.5 threshold — which would reject everything and stall the
  // whole pipeline at step 2. To keep it producing, promote the highest-scoring
  // niches that clear a quality FLOOR (so we never push genuine garbage) up to a
  // minimum count. These are the best niches available this run, so quality is
  // preserved relative to what was discovered.
  const MIN_VIABLE_NICHES = 3;
  const QUALITY_FLOOR = Math.max(4, scoreThreshold * 0.6);
  let promoted = 0;

  if (approved < MIN_VIABLE_NICHES) {
    const promotable = scoredNiches
      .filter((s) => !s.passed && s.composite >= QUALITY_FLOOR)
      .sort((a, b) => b.composite - a.composite)
      .slice(0, MIN_VIABLE_NICHES - approved);

    for (const candidate of promotable) {
      await context.db.update(niches).set({
        status: "approved",
        passedThreshold: true,
        updatedAt: new Date().toISOString(),
      }).where(eq(niches.id, candidate.id));
      context.approvedNicheIds.push(candidate.id);
      approved++;
      rejected--;
      promoted++;
      log("info", `[Step 02] Promoted best-available niche "${candidate.name}" (${candidate.composite}/10, below ${scoreThreshold} threshold but above ${QUALITY_FLOOR.toFixed(1)} floor) so the pipeline keeps producing`);
    }

    if (promotable.length === 0 && scoredNiches.length > 0) {
      const best = Math.max(...scoredNiches.map((s) => s.composite));
      log("warn", `[Step 02] No niches cleared the ${QUALITY_FLOOR.toFixed(1)} quality floor (best was ${best}/10) — nothing promoted. Lower niche_score_threshold or improve seed niches.`);
    }
  }

  const promotedNote = promoted > 0 ? `, ${promoted} promoted as best-available` : "";

  return {
    status: "completed",
    message: `Scored ${toScore.length} niches: ${approved} approved${promotedNote}, ${rejected} rejected (threshold: ${scoreThreshold})`,
    cost: totalCost,
    data: { scored: toScore.length, approved, rejected, promoted, threshold: scoreThreshold },
  };
}
