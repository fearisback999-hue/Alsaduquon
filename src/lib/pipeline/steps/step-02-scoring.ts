import type { PipelineContext, StepResult } from "../context";
import { niches, settings } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { chatCompletion, StructuredOutputError } from "@/lib/ai/client";
import { NichePreResearchSchema, NicheScoringSchema, type NichePreResearch } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { SCORING_WEIGHTS, SCORE_THRESHOLD } from "@/lib/types";
import { formatSalesContextForScoring } from "@/lib/pipeline/sales-feedback";
import { getActiveSeasons, matchNicheToSeason } from "@/lib/pipeline/seasonal-calendar";
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

  // Load sales context once for all niches
  const salesContext = await formatSalesContextForScoring();

  // Check if seasonal boost is enabled
  const seasonalSetting = await context.db.select().from(settings).where(eq(settings.key, "seasonal_boost_enabled")).get();
  const seasonalBoostEnabled = seasonalSetting?.value !== "false"; // default true
  const activeSeasons = seasonalBoostEnabled ? getActiveSeasons() : [];

  let approved = 0;
  let rejected = 0;
  let totalCost = 0;

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

      await trackTextUsage({
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

    // Phase B: Scoring with enriched context
    const scoringPrompt = `Analyze this print-on-demand niche and rate each metric on a scale of 0-10.

Niche: "${safeNicheName}"

HARD DATA:
- Search volume: ${niche.searchVolume ?? "not available"} monthly searches
- Competition level: ${niche.competitionLevel ?? "not available"} (0-1 scale, 1 = highest)
- Trend direction from APIs: ${niche.trendDirection ?? "not available"}

PRE-RESEARCH ANALYSIS:
- Sales velocity assessment: ${research?.sales_velocity_assessment ?? "unknown"} — ${research?.sales_velocity_reasoning ?? "no data"}
- Seasonality: ${research?.seasonality_assessment ?? "unknown"} (peak months: ${research?.peak_months.join(", ") ?? "N/A"}) — ${research?.seasonality_reasoning ?? "no data"}
- Trend trajectory: ${research?.trend_assessment ?? "unknown"} — ${research?.trend_reasoning ?? "no data"}
- Market saturation: ${research?.saturation_assessment ?? "unknown"}
- Overall viability: ${research?.overall_viability ?? "no data"}

OUR STORE'S HISTORICAL PERFORMANCE:
${salesContext}

Rate these metrics (0-10 scale, 10 = best for a POD seller):
1. search_volume_score: How high is demand? Use the search volume number if available. (weight: ${SCORING_WEIGHTS.searchVolume})
2. competition_score: How LOW is competition? 10 = wide open market. Consider saturation assessment. (weight: ${SCORING_WEIGHTS.competition})
3. sales_velocity_score: How fast will items sell? Use the velocity assessment and comparable niche data. (weight: ${SCORING_WEIGHTS.salesVelocity})
4. seasonality_score: How evergreen is this? 10 = year-round demand, 3 = single-month spike. (weight: ${SCORING_WEIGHTS.seasonality})
5. trending_score: Growth trajectory? 10 = explosive growth, 5 = stable, 2 = declining. (weight: ${SCORING_WEIGHTS.trending})

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

      await trackTextUsage({
        model: result.model,
        operation: "niche_scoring",
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        pipelineRunId: context.pipelineRunId,
      });

      const scores = result.parsed!;
      let composite =
        scores.search_volume_score * SCORING_WEIGHTS.searchVolume +
        scores.competition_score * SCORING_WEIGHTS.competition +
        scores.sales_velocity_score * SCORING_WEIGHTS.salesVelocity +
        scores.seasonality_score * SCORING_WEIGHTS.seasonality +
        scores.trending_score * SCORING_WEIGHTS.trending;

      // Apply seasonal boost if niche matches an active season
      let seasonalMatch: string | null = null;
      if (activeSeasons.length > 0) {
        const match = matchNicheToSeason(niche.name, activeSeasons);
        if (match) {
          composite += match.scoreBoost;
          seasonalMatch = match.name;
        }
      }

      const passed = composite >= SCORE_THRESHOLD;

      await context.db.update(niches).set({
        compositeScore: Math.round(composite * 100) / 100,
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

  return {
    status: "completed",
    message: `Scored ${toScore.length} niches: ${approved} approved, ${rejected} rejected (threshold: ${SCORE_THRESHOLD})`,
    cost: totalCost,
    data: { scored: toScore.length, approved, rejected },
  };
}
