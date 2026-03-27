import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "./rate-limiter";

export interface TrendResult {
  keyword: string;
  searchVolume: number;
  competition: number; // 0-1
  trendDirection: string; // up, down, stable
  source: "podcs" | "flying_research" | "etsy_trends";
}

// PodCS API
export async function getPodCSTrends(category?: string): Promise<TrendResult[]> {
  const apiKey = process.env.PODCS_API_KEY;
  if (!apiKey) return [];

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
  } catch {
    return [];
  }
}

// FlyingResearch API
export async function getFlyingResearchVolume(keywords: string[]): Promise<TrendResult[]> {
  const apiKey = process.env.FLYING_RESEARCH_API_KEY;
  if (!apiKey) return [];

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
  } catch {
    return [];
  }
}

// Etsy search trends (scrapes Etsy's trending searches)
export async function getEtsyTrends(): Promise<TrendResult[]> {
  try {
    // Use Etsy's public API for trending items
    const response = await withRetry(async () => {
      const res = await fetch("https://openapi.etsy.com/v3/application/buyer-taxonomy/nodes", {
        headers: { "x-api-key": process.env.ETSY_CLIENT_ID! },
      });
      if (!res.ok) throw new ExternalAPIError("Etsy", res.status, await res.text());
      return res.json();
    });

    const data = response as { results: Array<{ name: string; id: number }> };
    return data.results.slice(0, 20).map((item) => ({
      keyword: item.name.toLowerCase(),
      searchVolume: 0, // Not available from this endpoint
      competition: 0.5,
      trendDirection: "stable",
      source: "etsy_trends" as const,
    }));
  } catch {
    return [];
  }
}

export async function getAllTrends(): Promise<TrendResult[]> {
  const [podcs, etsy] = await Promise.all([
    getPodCSTrends(),
    getEtsyTrends(),
  ]);

  const all = [...podcs, ...etsy];

  // Deduplicate by keyword (case-insensitive)
  const seen = new Map<string, TrendResult>();
  for (const item of all) {
    const key = item.keyword.toLowerCase().trim();
    const existing = seen.get(key);
    if (!existing || item.searchVolume > existing.searchVolume) {
      seen.set(key, item);
    }
  }

  return Array.from(seen.values());
}
