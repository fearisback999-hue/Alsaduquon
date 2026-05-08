import type { PipelineContext, StepResult } from "../context";
import { niches } from "@/lib/db/schema";
import { getAllTrends, getFlyingResearchVolume, expandNichesWithAI, type TrendResult } from "@/lib/external/trend-apis";
import { batchValidateNiches } from "@/lib/external/etsy-search";
import { enforcebudget } from "@/lib/cost/guard";
import { drillMicroNiches, type MicroNiche } from "@/lib/research/micro-niche-drill";
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

  const allCandidates = [...trendResults, ...expanded, ...microDrillResults];

  // ---- ETSY MARKETPLACE VALIDATION ----
  // Validate ALL candidates (especially AI-expanded ones) against real Etsy data.
  // Kills niches with zero demand before we waste money scoring/generating for them.
  const candidateKeywords = allCandidates.map((c) => c.keyword);
  const etsyValidation = await batchValidateNiches(candidateKeywords);

  let etsyFiltered = 0;

  // Load existing niche names for dedup (exact + fuzzy)
  const existingNiches = await context.db.select({ name: niches.name }).from(niches).all();
  const existingExact = new Set(existingNiches.map((n) => n.name));
  const existingNormalized = new Set(existingNiches.map((n) => normalizeForDedup(n.name)));

  const newNicheIds: string[] = [];
  let skippedDuplicates = 0;

  for (const trend of allCandidates) {
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

    // Etsy viability gate — reject niches with no real marketplace demand
    const etsyData = etsyValidation.get(trend.keyword);
    if (etsyData && etsyData.viabilityScore < MIN_ETSY_VIABILITY_SCORE) {
      etsyFiltered++;
      log("info", `[Step 01] Etsy-filtered "${trend.keyword}" — viability ${etsyData.viabilityScore}/100 (${etsyData.activeListingCount} listings, avg ${etsyData.avgFavorites} favorites, ${etsyData.demandSignal} demand, ${etsyData.competitionLevel} competition)`);
      continue;
    }

    // Enrich with Etsy data if available
    const realCompetition = etsyData
      ? etsyData.activeListingCount >= 50000 ? 0.95
        : etsyData.activeListingCount >= 10000 ? 0.75
        : etsyData.activeListingCount >= 1000 ? 0.45
        : 0.2
      : trend.competition;

    const realSearchVolume = etsyData && etsyData.avgFavorites > 0
      ? Math.max(trend.searchVolume, etsyData.avgFavorites * 10)
      : trend.searchVolume;

    existingExact.add(exactName);
    existingNormalized.add(normalizedName);

    const microMeta = trend.source === "micro_drill" ? microNicheMeta.get(exactName) : undefined;

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

  context.discoveredNicheIds = newNicheIds;

  if (skippedDuplicates > 0) {
    log("info", `[Step 01] Skipped ${skippedDuplicates} duplicate/near-duplicate niches`);
  }
  if (etsyFiltered > 0) {
    log("info", `[Step 01] Etsy validation filtered out ${etsyFiltered} low-viability niches`);
  }

  return {
    status: "completed",
    message: `Discovered ${newNicheIds.length} new niches from ${trendResults.length} trends + ${expanded.length} AI expansions + ${microDrillResults.length} micro-drilled (${skippedDuplicates} duplicates, ${etsyFiltered} Etsy-filtered)`,
    data: {
      nichesFound: newNicheIds.length,
      totalTrends: trendResults.length,
      aiExpanded: expanded.length,
      microDrilled: microDrillResults.length,
      duplicatesSkipped: skippedDuplicates,
      etsyFiltered,
    },
  };
}
