import type { PipelineContext, StepResult } from "../context";
import { niches } from "@/lib/db/schema";
import { eq, inArray } from "drizzle-orm";
import { chatCompletion } from "@/lib/ai/client";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { SCORING_WEIGHTS, SCORE_THRESHOLD } from "@/lib/types";

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

  let approved = 0;
  let rejected = 0;
  let totalCost = 0;

  for (const niche of toScore) {
    await enforcebudget(0.01); // Rough estimate per scoring call

    const prompt = `Analyze this potential print-on-demand niche and rate each metric on a scale of 0-10.

Niche: "${niche.name}"
Known data:
- Search volume: ${niche.searchVolume ?? "unknown"}
- Competition level: ${niche.competitionLevel ?? "unknown"}
- Trend direction: ${niche.trendDirection ?? "unknown"}

Rate these metrics (0-10 scale, 10 = best for a POD seller):
1. search_volume_score: How high is demand? (weight: ${SCORING_WEIGHTS.searchVolume})
2. competition_score: How LOW is competition? (10 = very low competition, weight: ${SCORING_WEIGHTS.competition})
3. sales_velocity_score: How fast are items selling? (weight: ${SCORING_WEIGHTS.salesVelocity})
4. seasonality_score: How evergreen is this niche? (10 = year-round demand, weight: ${SCORING_WEIGHTS.seasonality})
5. trending_score: Is this trending up? (weight: ${SCORING_WEIGHTS.trending})

Return JSON only:
{
  "search_volume_score": <number>,
  "competition_score": <number>,
  "sales_velocity_score": <number>,
  "seasonality_score": <number>,
  "trending_score": <number>,
  "reasoning": "<1 sentence>"
}`;

    const result = await chatCompletion(prompt, {
      systemPrompt: "You are a POD market analyst. Score niches accurately based on real market knowledge. Be critical — most niches are mediocre.",
      maxTokens: 300,
      temperature: 0.3,
      jsonMode: true,
    });

    await trackTextUsage({
      model: result.model,
      operation: "niche_scoring",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      pipelineRunId: context.pipelineRunId,
    });

    try {
      const scores = JSON.parse(result.content);
      const composite =
        (scores.search_volume_score ?? 5) * SCORING_WEIGHTS.searchVolume +
        (scores.competition_score ?? 5) * SCORING_WEIGHTS.competition +
        (scores.sales_velocity_score ?? 5) * SCORING_WEIGHTS.salesVelocity +
        (scores.seasonality_score ?? 5) * SCORING_WEIGHTS.seasonality +
        (scores.trending_score ?? 5) * SCORING_WEIGHTS.trending;

      const passed = composite >= SCORE_THRESHOLD;

      await context.db.update(niches).set({
        compositeScore: Math.round(composite * 100) / 100,
        scoreBreakdown: JSON.stringify(scores),
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
    } catch {
      // If parsing fails, reject the niche
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
