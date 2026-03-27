import type { PipelineContext, StepResult } from "../context";
import { niches } from "@/lib/db/schema";
import { getAllTrends, getFlyingResearchVolume } from "@/lib/external/trend-apis";
import { eq } from "drizzle-orm";

export default async function execute(context: PipelineContext): Promise<StepResult> {
  if (context.dryRun) {
    return { status: "completed", message: "Dry run: skipped research" };
  }

  // Fetch trends from all sources in parallel
  const trendResults = await getAllTrends();

  if (trendResults.length === 0) {
    return { status: "completed", message: "No trends found from any source", data: { nichesFound: 0 } };
  }

  // Enrich with FlyingResearch volume data for keywords that don't have it
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

  // Insert or skip existing niches
  const newNicheIds: string[] = [];
  for (const trend of trendResults) {
    // Check if niche already exists (idempotency)
    const existing = await context.db
      .select()
      .from(niches)
      .where(eq(niches.name, trend.keyword.toLowerCase().trim()))
      .get();

    if (existing) continue;

    const [inserted] = await context.db.insert(niches).values({
      name: trend.keyword.toLowerCase().trim(),
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

  return {
    status: "completed",
    message: `Discovered ${newNicheIds.length} new niches from ${trendResults.length} trend results`,
    data: { nichesFound: newNicheIds.length, totalTrends: trendResults.length },
  };
}
