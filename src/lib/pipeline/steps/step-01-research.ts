import type { PipelineContext, StepResult } from "../context";
import { niches } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { getAllTrends, getFlyingResearchVolume, expandNichesWithAI, type TrendResult } from "@/lib/external/trend-apis";
import { batchValidateNiches } from "@/lib/external/etsy-search";
import { enforcebudget } from "@/lib/cost/guard";
import { drillMicroNiches, type MicroNiche } from "@/lib/research/micro-niche-drill";
import { rankCandidates } from "@/lib/research/candidate-ranking";
import { screenNicheForIP } from "@/lib/ai/moderation";
import { log } from "@/lib/logger";

const POD_PRODUCT_WORDS = /\b(t-?shirts?|tees?|shirts?|hoodies?|mugs?|cups?|sweatshirts?|tank\s*tops?|posters?|stickers?|prints?|designs?)\b/g;
const TRAILING_S = /s\b/g;

const MIN_ETSY_VIABILITY_SCORE = 25;

function normalizeForDedup(keyword: string): string {
  return keyword
    .toLowerCase()
    .trim()
    .replace(POD_PRODUCT_WORDS, "")
    .replace(TRAILING_S, "")
    .replace(/\s+/g, " ")
    .trim();
}

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped research" };
  }

  // Fetch trends from PodCS
  const trendResults = await getAllTrends();

  if (trendResults.length === 0) {
    log("warn", "[Step 01] No trends from primary sources — pipeline will have nothing to score");
    return { status: "completed", message: "No trends found from any source", data: { nichesFound: 0 } };
  }

  // Enrich with FlyingResearch volume data for keywords missing it
  const keywordsNeedingVolume = trendResults
    .filter((t) => !t.searchVolume || t.searchVolume === 0)
    .map((t) => t.keyword);

  if (keywordsNeedingVolume.length > 0) {
    const volumeData = await getFlyingResearchVolume(keywordsNeedingVolume);
    for (const vol of volumeData) {
      const existing = trendResults.find((t) => t.keyword.toLowerCase() === vol.keyword.toLowerCase());
      if (existing && (!existing.searchVolume || vol.searchVolume > existing.searchVolume)) {
        existing.searchVolume = vol.searchVolume;
        existing.competition = vol.competition;
      }
    }
  }

  // AI keyword expansion — turn broad trends into specific POD niches
  await enforcebudget(0.01);
  const seedKeywords = trendResults.map((t) => t.keyword);
  const expanded = await expandNichesWithAI(seedKeywords, context.pipelineRunId);

  // Micro-niche drilling — for the top-volume seeds, decompose into
  // ultra-specific buyer-persona x occasion x style tuples. Complements the
  // shallower expandNichesWithAI by going deeper on a few high-signal seeds.
  const topSeeds = [...trendResults]
    .sort((a, b) => (b.searchVolume ?? 0) - (a.searchVolume ?? 0))
    .slice(0, 5);

  const microDrillResults: TrendResult[] = [];
  // keyed by lowercased keyword -> persona metadata, used at insert time
  const microNicheMeta = new Map<string, MicroNiche>();

  for (const seed of topSeeds) {
    const drilled = await drillMicroNiches(seed.keyword, 5, context.pipelineRunId);
    for (const m of drilled) {
      const key = m.keyword.toLowerCase().trim();
      if (!microNicheMeta.has(key)) {
        microNicheMeta.set(key, m);
        microDrillResults.push({
          keyword: m.keyword,
          searchVolume: 0,
          competition: 0.5,
          trendDirection: "growing",
          source: "micro_drill",
        });
      }
    }
  }

  if (microDrillResults.length > 0) {
    log(
      "info",
      `[Step 01] Micro-drill produced ${microDrillResults.length} buyer-persona micro-niches from top ${topSeeds.length} seeds`,
    );
  }

  // When AI expansion AND micro-drilling both failed, we only have broad
  // evergreen seeds. These are meant as INPUT to AI expansion, not as
  // standalone niche candidates — Etsy rightfully filters them as
  // oversaturated. Skip the Etsy gate entirely so the seeds can at least
  // reach Step 2's AI scoring, and warn loudly.
  const aiProducedNothing = expanded.length === 0 && microDrillResults.length === 0;
  if (aiProducedNothing && trendResults.length > 0) {
    log("warn", "[Step 01] AI expansion AND micro-drilling both produced 0 results — Etsy viability gate will be skipped so seed niches can reach AI scoring in Step 2. Check your OPENAI_API_KEY / ANTHROPIC_API_KEY.");
  }

  const allCandidates = [...trendResults, ...expanded, ...microDrillResults];

  // ---- PRE-RANK + CAP ----
  // Rank every candidate on the hard signals we already have (demand,
  // competition, trend momentum, long-tail specificity) so the best niches are
  // processed first and survive the per-run cap. This focuses the expensive
  // Step-2 AI scoring (2 LLM calls/niche) on the highest-potential niches
  // instead of burning budget down a long tail of also-rans. The cap defaults
  // generously (so normal runs are untouched) and only reins in floods; set
  // MAX_NICHES_PER_RUN to tighten spend.
  const maxPerRun = (() => {
    const n = parseInt(process.env.MAX_NICHES_PER_RUN ?? "", 10);
    return Number.isFinite(n) && n > 0 ? n : 60;
  })();
  const rankedCandidates = rankCandidates(allCandidates);
  // Validate with 2× headroom so dedup / IP / viability filtering still leaves
  // ~maxPerRun survivors, without paying to validate the entire long tail.
  const candidatePool = rankedCandidates.slice(0, Math.min(rankedCandidates.length, maxPerRun * 2));

  // ---- ETSY MARKETPLACE VALIDATION ----
  // Validate candidates (especially AI-expanded ones) against real Etsy data.
  // Kills niches with zero demand before we waste money scoring/generating for them.
  const candidateKeywords = candidatePool.map((c) => c.keyword);
  const etsyValidation = await batchValidateNiches(candidateKeywords);

  // Only enforce the Etsy viability gate when Etsy is actually connected.
  // Without credentials every keyword scores 0, which would wrongly kill the
  // entire pipeline. When Etsy isn't configured we let niches through and
  // rely on Step 2's AI scoring instead.
  const etsyConfigured = !!process.env.ETSY_CLIENT_ID;
  if (!etsyConfigured) {
    log("warn", "[Step 01] Etsy not connected — skipping marketplace viability gate (niches will be scored by AI in Step 2)");
  } else {
    const scores: string[] = [];
    etsyValidation.forEach((v) => { scores.push(`${v.keyword.slice(0, 30)}=${v.viabilityScore}(${v.dataAvailable ? "live" : "fallback"})`); });
    log("info", `[Step 01] Etsy viability scores (threshold ${MIN_ETSY_VIABILITY_SCORE}): ${scores.join(", ")}`);
  }

  let etsyFiltered = 0;

  // Load existing niche names for dedup (exact + fuzzy).
  // Rejected niches older than the cooldown period are EXCLUDED from the dedup
  // set so they can be re-evaluated — they failed scoring before but may pass
  // now with different AI assessment or updated data.
  const REJECTED_COOLDOWN_HOURS = 12;
  const cooldownCutoff = new Date(Date.now() - REJECTED_COOLDOWN_HOURS * 60 * 60 * 1000).toISOString();

  const existingNiches = await context.db.select({ name: niches.name, status: niches.status, updatedAt: niches.updatedAt }).from(niches).all();

  const reEvaluatable = new Set(
    existingNiches
      .filter((n) => n.status === "rejected" && n.updatedAt < cooldownCutoff)
      .map((n) => n.name),
  );

  const dedupNiches = existingNiches.filter((n) => !reEvaluatable.has(n.name));
  const existingExact = new Set(dedupNiches.map((n) => n.name));
  const existingNormalized = new Set(dedupNiches.map((n) => normalizeForDedup(n.name)));

  if (reEvaluatable.size > 0) {
    log("info", `[Step 01] ${reEvaluatable.size} previously-rejected niches are eligible for re-evaluation (cooldown ${REJECTED_COOLDOWN_HOURS}h expired)`);
  }

  const newNicheIds: string[] = [];
  let skippedDuplicates = 0;
  let ipBlocked = 0;

  for (const trend of candidatePool) {
    // Stop once we've filled the run's best-N budget — candidatePool is
    // ranked, so the survivors are the highest-potential niches.
    if (newNicheIds.length >= maxPerRun) break;

    const exactName = trend.keyword.toLowerCase().trim();
    const normalizedName = normalizeForDedup(exactName);

    if (exactName.length < 3 || normalizedName.length < 2) continue;

    if (existingExact.has(exactName)) {
      skippedDuplicates++;
      continue;
    }

    if (existingNormalized.has(normalizedName)) {
      skippedDuplicates++;
      continue;
    }

    // IP gate at the source. Trend APIs and AI expansion surface trademarked
    // and derivative keywords ("disney aesthetic", "taylor swift gifts") that
    // would otherwise flow into concepts, image prompts, titles, and tags —
    // the #1 cause of permanent Etsy bans. Reject before spending a cent on it.
    const ipViolation = screenNicheForIP(exactName);
    if (ipViolation) {
      ipBlocked++;
      log("warn", `[Step 01] IP-blocked niche "${exactName}" — ${ipViolation}`);
      continue;
    }

    // Etsy viability gate — reject niches with no real marketplace demand.
    // Skipped when: (a) Etsy isn't connected, or (b) AI expansion failed
    // and we only have broad seeds that need Step 2 AI scoring.
    //
    // CRITICAL: only filter when `dataAvailable` is true. A failed Etsy API
    // call (bad/expired credentials, rate limit, outage) returns viability 0,
    // which would otherwise filter out EVERY niche and produce an empty
    // pipeline. When the call failed we let the niche through and rely on
    // Step 2's AI scoring instead of fail-closing the whole run.
    const etsyData = etsyValidation.get(trend.keyword);
    if (etsyConfigured && etsyData && !etsyData.dataAvailable) {
      log("warn", `[Step 01] Etsy lookup unavailable for "${trend.keyword}" — letting it through (will be AI-scored in Step 2)`);
    }
    if (etsyConfigured && !aiProducedNothing && etsyData && etsyData.dataAvailable && etsyData.viabilityScore < MIN_ETSY_VIABILITY_SCORE) {
      etsyFiltered++;
      log("info", `[Step 01] Etsy-filtered "${trend.keyword}" — viability ${etsyData.viabilityScore}/100 (${etsyData.activeListingCount} listings, avg ${etsyData.avgFavorites} favorites, ${etsyData.demandSignal} demand, ${etsyData.competitionLevel} competition)`);
      continue;
    }

    // Enrich with Etsy data only when we actually got a real response —
    // otherwise fall back to the trend's own competition/volume estimates.
    const hasEtsyData = !!etsyData && etsyData.dataAvailable;
    const realCompetition = hasEtsyData
      ? etsyData!.activeListingCount >= 50000 ? 0.95
        : etsyData!.activeListingCount >= 10000 ? 0.75
        : etsyData!.activeListingCount >= 1000 ? 0.45
        : 0.2
      : trend.competition;

    const realSearchVolume = hasEtsyData && etsyData!.avgFavorites > 0
      ? Math.max(trend.searchVolume, etsyData!.avgFavorites * 10)
      : trend.searchVolume;

    existingExact.add(exactName);
    existingNormalized.add(normalizedName);

    const microMeta = trend.source === "micro_drill" ? microNicheMeta.get(exactName) : undefined;

    if (reEvaluatable.has(exactName)) {
      // Reset previously-rejected niche for re-evaluation instead of inserting
      const [updated] = await context.db.update(niches).set({
        status: "discovered",
        source: trend.source,
        searchVolume: realSearchVolume,
        competitionLevel: realCompetition,
        trendDirection: trend.trendDirection,
        buyerPersona: microMeta?.buyerPersona ?? null,
        occasion: microMeta?.occasion ?? null,
        style: microMeta?.style ?? null,
        compositeScore: null,
        scoreBreakdown: null,
        passedThreshold: false,
        pipelineRunId: context.pipelineRunId,
        updatedAt: new Date().toISOString(),
      }).where(eq(niches.name, exactName)).returning();
      newNicheIds.push(updated.id);
      reEvaluatable.delete(exactName);
    } else {
      const [inserted] = await context.db.insert(niches).values({
        name: exactName,
        source: trend.source,
        status: "discovered",
        searchVolume: realSearchVolume,
        competitionLevel: realCompetition,
        trendDirection: trend.trendDirection,
        buyerPersona: microMeta?.buyerPersona,
        occasion: microMeta?.occasion,
        style: microMeta?.style,
        pipelineRunId: context.pipelineRunId,
      }).returning();
      newNicheIds.push(inserted.id);
    }
  }

  context.discoveredNicheIds = newNicheIds;

  if (skippedDuplicates > 0) {
    log("info", `[Step 01] Skipped ${skippedDuplicates} duplicate/near-duplicate niches`);
  }
  if (etsyFiltered > 0) {
    log("info", `[Step 01] Etsy validation filtered out ${etsyFiltered} low-viability niches`);
  }
  if (ipBlocked > 0) {
    log("info", `[Step 01] IP gate blocked ${ipBlocked} trademarked/derivative niches before any spend`);
  }

  return {
    status: "completed",
    message: `Discovered ${newNicheIds.length} new niches from ${trendResults.length} trends + ${expanded.length} AI expansions + ${microDrillResults.length} micro-drilled (${skippedDuplicates} duplicates, ${etsyFiltered} Etsy-filtered, ${ipBlocked} IP-blocked)`,
    data: {
      nichesFound: newNicheIds.length,
      totalTrends: trendResults.length,
      aiExpanded: expanded.length,
      microDrilled: microDrillResults.length,
      duplicatesSkipped: skippedDuplicates,
      etsyFiltered,
      ipBlocked,
    },
  };
}
