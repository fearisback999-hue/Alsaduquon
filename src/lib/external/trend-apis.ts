import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "./rate-limiter";
import { log } from "@/lib/logger";

export interface TrendResult {
  keyword: string;
  searchVolume: number;
  competition: number; // 0-1
  trendDirection: string; // up, down, stable
  source: "podcs" | "flying_research" | "etsy_trends" | "ai_expansion" | "micro_drill" | "seed_fallback";
}

// Evergreen POD seed categories. Used when no paid trend API (PodCS /
// FlyingResearch) is configured — the AI expansion step turns these broad
// buckets into specific, sellable long-tail niches. This lets the pipeline
// run end-to-end with only an OPENAI_API_KEY.
const EVERGREEN_SEEDS = [
  "dog mom gifts",
  "registered nurse appreciation",
  "teacher life",
  "fishing dad",
  "plant lady",
  "mental health awareness",
  "gym motivation",
  "cat lover humor",
  "retro gaming",
  "coffee addict",
  "camping outdoors",
  "new mom baby shower",
  "sarcastic office humor",
  "vintage 80s aesthetic",
  "book lover reading",
];

export function getSeedFallbackTrends(): TrendResult[] {
  return EVERGREEN_SEEDS.map((keyword) => ({
    keyword,
    searchVolume: 0,
    competition: 0.5,
    trendDirection: "stable",
    source: "seed_fallback" as const,
  }));
}

// PodCS API
export async function getPodCSTrends(category?: string): Promise<TrendResult[]> {
  const apiKey = process.env.PODCS_API_KEY;
  if (!apiKey) {
    log("warn", "[Step 01] PODCS_API_KEY not set — skipping PodCS trend source");
    return [];
  }

  await rateLimit("podcs");

  try {
    const params = new URLSearchParams({ api_key: apiKey });
    if (category) params.set("category", category);

    const response = await withRetry(async () => {
      const res = await fetch(`https://api.podcs.com/v1/trends?${params.toString()}`);
      if (!res.ok) throw new ExternalAPIError("PodCS", res.status, await res.text());
      return res.json();
    });

    const data = response as Array<{ keyword: string; volume: number; competition: number; trend: string }>;
    return data.map((item) => ({
      keyword: item.keyword,
      searchVolume: item.volume ?? 0,
      competition: item.competition ?? 0.5,
      trendDirection: item.trend ?? "stable",
      source: "podcs" as const,
    }));
  } catch (error) {
    log("error", "[Step 01] PodCS API failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// FlyingResearch API — used for volume enrichment
export async function getFlyingResearchVolume(keywords: string[]): Promise<TrendResult[]> {
  const apiKey = process.env.FLYING_RESEARCH_API_KEY;
  if (!apiKey) {
    log("warn", "[Step 01] FLYING_RESEARCH_API_KEY not set — skipping volume enrichment");
    return [];
  }

  await rateLimit("flying_research");

  try {
    const response = await withRetry(async () => {
      const res = await fetch("https://api.flyingresearch.com/v1/volume", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ keywords }),
      });
      if (!res.ok) throw new ExternalAPIError("FlyingResearch", res.status, await res.text());
      return res.json();
    });

    const data = response as Array<{ keyword: string; monthly_volume: number; competition_score: number; trend: string }>;
    return data.map((item) => ({
      keyword: item.keyword,
      searchVolume: item.monthly_volume ?? 0,
      competition: item.competition_score ?? 0.5,
      trendDirection: item.trend ?? "stable",
      source: "flying_research" as const,
    }));
  } catch (error) {
    log("error", "[Step 01] FlyingResearch API failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

// AI-powered keyword expansion — turns broad trend keywords into specific,
// sellable POD niche phrases that people actually search for on Etsy
export async function expandNichesWithAI(
  seedKeywords: string[],
  pipelineRunId?: string,
): Promise<TrendResult[]> {
  if (seedKeywords.length === 0) return [];

  const { chatCompletion } = await import("@/lib/ai/client");
  const { NicheExpansionSchema } = await import("@/lib/ai/schemas");
  const { trackTextUsage } = await import("@/lib/ai/token-tracker");
  const { sanitizeForPrompt } = await import("@/lib/ai/sanitize");

  const safeKeywords = seedKeywords.slice(0, 15).map((k) => sanitizeForPrompt(k));

  const prompt = `You are an Etsy POD (print-on-demand) niche research expert. Given these trending keywords from market research, generate 3-5 specific, sellable print-on-demand niche ideas per keyword.

TRENDING KEYWORDS:
${safeKeywords.map((k, i) => `${i + 1}. ${k}`).join("\n")}

RULES:
- Each expanded niche should be a specific, long-tail phrase (2-5 words) someone would search on Etsy for t-shirts, mugs, hoodies, or posters
- Target specific audiences: "dog mom", "retired nurse", "gamer dad", "plant lady"
- Include emotional hooks: funny, sarcastic, motivational, vintage, retro
- Focus on gift-worthy phrases: birthday, mother's day, occupation pride
- Avoid generic single words — be specific enough to design for
- Don't repeat the seed keyword as-is
- Aim for underserved micro-niches, not oversaturated ones like "funny cat"

Return your expanded niches as JSON.`;

  try {
    const result = await chatCompletion(prompt, {
      systemPrompt:
        "You are a POD market researcher specializing in Etsy. Generate specific, commercially viable niche keywords that real buyers search for. Be creative but realistic.",
      schema: NicheExpansionSchema,
      schemaName: "niche_expansion",
      maxTokens: 1500,
      temperature: 0.85,
    });

    await trackTextUsage({
      model: result.model,
      operation: "niche_expansion",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      pipelineRunId,
    });

    const expanded = result.parsed?.expanded_niches ?? [];
    log("info", `[Step 01] AI expanded ${safeKeywords.length} seeds into ${expanded.length} niche candidates`);

    return expanded.map((n) => ({
      keyword: n.keyword,
      searchVolume: 0,
      competition: 0.5,
      trendDirection: "growing",
      source: "ai_expansion" as const,
    }));
  } catch (error) {
    log("error", "[Step 01] AI niche expansion failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

export async function getAllTrends(): Promise<TrendResult[]> {
  let podcs = await getPodCSTrends();

  // No paid trend source configured (or it returned nothing)? Fall back to
  // evergreen seeds so the AI expansion step still has something to work
  // with. This keeps the pipeline functional with only an OpenAI key.
  if (podcs.length === 0) {
    log("info", "[Step 01] No trend-API results — using evergreen seed fallback so the pipeline can still run");
    podcs = getSeedFallbackTrends();
  }

  // Deduplicate by keyword (case-insensitive)
  const seen = new Map<string, TrendResult>();
  for (const item of podcs) {
    const key = item.keyword.toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || item.searchVolume > existing.searchVolume) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}
