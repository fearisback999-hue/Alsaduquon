import { withRetry } from "@/lib/retry";
import { log } from "@/lib/logger";
import { validateNicheOnEtsy } from "@/lib/external/etsy-search";

/**
 * A single platform's read on a niche keyword.
 *
 * `presence` is the binary "does this niche show up at all" gate; cross-platform
 * triangulation cares first about how many platforms can see the niche, and only
 * then about how strongly each one does. `strength` is normalized to 0-10 so
 * scores are comparable across very different platform mechanics (Etsy listing
 * counts vs. Reddit thread counts, etc.).
 */
export interface PlatformSignal {
  platform: "etsy" | "google_trends" | "pinterest" | "tiktok" | "amazon" | "reddit";
  presence: boolean;
  strength: number; // 0-10
  trend: "rising" | "stable" | "declining";
}

export interface TriangulationResult {
  score: number; // 0-100
  platforms: number; // count of platforms with presence
  rising: number; // count of platforms trending up
}

/**
 * Aggregates demand signals across every platform we can cheaply check.
 *
 * Each platform helper is best-effort and returns null on failure so a single
 * flaky source can't poison the whole signal. We use Promise.allSettled for
 * parallelism but normalize all rejections to null/empty signals downstream.
 */
export async function getCrossPlatformSignals(keyword: string): Promise<PlatformSignal[]> {
  const results = await Promise.allSettled([
    fetchEtsySignal(keyword),
    fetchGoogleTrends(keyword),
    fetchPinterestSignal(keyword),
    fetchTikTokSignal(keyword),
    fetchRedditSignal(keyword),
    fetchAmazonSignal(keyword),
  ]);

  const signals: PlatformSignal[] = [];
  for (const r of results) {
    if (r.status === "fulfilled" && r.value) {
      signals.push(r.value);
    }
  }
  return signals;
}

/**
 * Etsy is always available (we already validate every niche there).
 * Strength is log10(activeListingCount) capped at 10 — this gives us a smooth
 * gradient where 10 listings = 1.0, 1k = 3.0, 10M (cap) = 7.0, etc.
 */
export async function fetchEtsySignal(keyword: string): Promise<PlatformSignal | null> {
  try {
    const data = await validateNicheOnEtsy(keyword);
    const count = data.activeListingCount ?? 0;
    const presence = count > 0;
    const strength = count > 0 ? Math.min(10, Math.log10(count)) : 0;
    return {
      platform: "etsy",
      presence,
      strength: Math.round(strength * 100) / 100,
      // We don't have listing-creation-date data here yet; treat as stable.
      trend: "stable",
    };
  } catch (error) {
    log("warn", `[cross-platform] Etsy signal failed for "${keyword}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * TODO: Implement Google Trends via https://trends.google.com/trends/api/explore.
 * The endpoint requires no API key but is rate-limited and returns content
 * prefixed with `)]}'` that needs stripping before JSON.parse. Real impl should
 * read the `interest_over_week` series, derive a 0-10 strength from peak interest,
 * and detect rising vs. declining via slope of the last 4 weeks vs. prior 4.
 */
export async function fetchGoogleTrends(
  keyword: string,
): Promise<PlatformSignal | null> {
  log("info", `[cross-platform] Google Trends not implemented for "${keyword}" — returning null`);
  return null;
}

/**
 * Pinterest stub. A real implementation would either call Pinterest's Trends
 * API (requires business account + access token) or scrape the search results
 * page for save counts. Saves-per-week makes a cleaner trend signal than
 * listing counts because Pinterest is a forward-looking discovery platform.
 */
export async function fetchPinterestSignal(keyword: string): Promise<PlatformSignal | null> {
  log("info", `[cross-platform] Pinterest not implemented for "${keyword}" — returning null`);
  return null;
}

/**
 * TikTok stub. Real implementation would query the TikTok Creative Center
 * (https://ads.tiktok.com/business/creativecenter/) trends endpoint or scrape
 * hashtag video counts for the niche keyword.
 */
export async function fetchTikTokSignal(keyword: string): Promise<PlatformSignal | null> {
  log("info", `[cross-platform] TikTok not implemented for "${keyword}" — returning null`);
  return null;
}

/**
 * Amazon stub. A real implementation would scrape merch/product search counts
 * or use a third-party Amazon SERP API. For now this just returns null.
 */
export async function fetchAmazonSignal(keyword: string): Promise<PlatformSignal | null> {
  log("info", `[cross-platform] Amazon not implemented for "${keyword}" — returning null`);
  return null;
}

/**
 * Reddit's public search.json gives us free, no-auth signal. We grab top
 * posts of the past week — the count of matching threads is a rough proxy
 * for community activity around the niche. Strength = log10(matches), capped
 * at 10. Trend stays "stable" because a single time-window query can't
 * tell us if Reddit interest is rising or falling.
 */
export async function fetchRedditSignal(keyword: string): Promise<PlatformSignal | null> {
  try {
    const url = `https://www.reddit.com/search.json?q=${encodeURIComponent(keyword)}&sort=top&t=week&limit=25`;
    const data = await withRetry(
      async () => {
        const res = await fetch(url, {
          headers: {
            // Reddit blocks the default fetch UA; spoof a browser-like UA.
            "User-Agent": "neopod-research/1.0 (cross-platform-signals)",
            Accept: "application/json",
          },
        });
        if (!res.ok) {
          throw new Error(`Reddit search failed (${res.status})`);
        }
        return res.json();
      },
      { maxAttempts: 2, baseDelayMs: 1000 },
    );

    const children = (data as { data?: { children?: unknown[] } })?.data?.children ?? [];
    const matches = Array.isArray(children) ? children.length : 0;
    const presence = matches > 0;
    const strength = matches > 0 ? Math.min(10, Math.log10(matches + 1) * 3.3) : 0;
    return {
      platform: "reddit",
      presence,
      strength: Math.round(strength * 100) / 100,
      trend: "stable",
    };
  } catch (error) {
    log("warn", `[cross-platform] Reddit signal failed for "${keyword}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Score the cross-platform signal mix. The intuition: a niche showing up on
 * three platforms with mediocre strength is a stronger lead than one platform
 * with a great strength, because demand signals usually leak across platforms
 * before they mature. So we sum strengths but multiply by a "platform breadth"
 * bonus (1x → 2.5x as we go from 1 → 4+ platforms with presence).
 */
export function computeTriangulationScore(signals: PlatformSignal[]): TriangulationResult {
  const present = signals.filter((s) => s.presence);
  const platforms = present.length;
  const rising = signals.filter((s) => s.trend === "rising").length;

  if (platforms === 0) {
    return { score: 0, platforms: 0, rising };
  }

  const totalStrength = present.reduce((sum, s) => sum + (Number.isFinite(s.strength) ? s.strength : 0), 0);

  let multiplier = 1;
  if (platforms === 2) multiplier = 1.5;
  else if (platforms === 3) multiplier = 2;
  else if (platforms >= 4) multiplier = 2.5;

  const raw = totalStrength * multiplier;
  const score = Math.min(100, Math.round(raw * 100) / 100);

  return { score, platforms, rising };
}
