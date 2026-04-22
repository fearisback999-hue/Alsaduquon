import type { PipelineContext, StepResult } from "../context";
import { niches } from "@/lib/db/schema";
import { getAllTrends, getFlyingResearchVolume, expandNichesWithAI } from "@/lib/external/trend-apis";
import { enforcebudget } from "@/lib/cost/guard";
import { log } from "@/lib/logger";

const POD_PRODUCT_WORDS = /\b(t-?shirts?|tees?|shirts?|hoodies?|mugs?|cups?|sweatshirts?|tank\s*tops?|posters?|stickers?|prints?|designs?)\b/g;
const TRAILING_S = /s\b/g;

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

  const allCandidates = [...trendResults, ...expanded];

  // Load existing niche names for dedup (exact + fuzzy)
  const existingNiches = await context.db.select({ name: niches.name }).from(niches).all();
  const existingExact = new Set(existingNiches.map((n) => n.name));
  const existingNormalized = new Set(existingNiches.map((n) => normalizeForDedup(n.name)));

  const newNicheIds: string[] = [];
  let skippedDuplicates = 0;

  for (const trend of allCandidates) {
    const exactName = trend.keyword.toLowerCase().trim();
    const normalizedName = normalizeForDedup(exactName);

    // Skip empty or too-short keywords
    if (exactName.length < 3 || normalizedName.length < 2) continue;

    // Exact duplicate
    if (existingExact.has(exactName)) {
      skippedDuplicates++;
      continue;
    }

    // Fuzzy duplicate (same root after stripping product words + plurals)
    if (existingNormalized.has(normalizedName)) {
      skippedDuplicates++;
      continue;
    }

    // Mark as seen so we also dedup within this batch
    existingExact.add(exactName);
    existingNormalized.add(normalizedName);

    const [inserted] = await context.db.insert(niches).values({
      name: exactName,
      source: trend.source,
      status: "discovered",
      searchVolume: trend.searchVolume,
      competitionLevel: trend.competition,
      trendDirection: trend.trendDirection,
      pipelineRunId: context.pipelineRunId,
    }).returning();

    newNicheIds.push(inserted.id);
  }

  context.discoveredNicheIds = newNicheIds;

  if (skippedDuplicates > 0) {
    log("info", `[Step 01] Skipped ${skippedDuplicates} duplicate/near-duplicate niches`);
  }

  return {
    status: "completed",
    message: `Discovered ${newNicheIds.length} new niches from ${trendResults.length} trends + ${expanded.length} AI expansions (${skippedDuplicates} duplicates skipped)`,
    data: {
      nichesFound: newNicheIds.length,
      totalTrends: trendResults.length,
      aiExpanded: expanded.length,
      duplicatesSkipped: skippedDuplicates,
    },
  };
}
