import { db } from "@/lib/db";
import { niches, nicheVelocitySnapshots } from "@/lib/db/schema";
import { eq, desc, inArray, and, gte } from "drizzle-orm";
import { batchValidateNiches } from "@/lib/external/etsy-search";
import { log } from "@/lib/logger";

export interface NicheSnapshotSignals {
  searchVolume?: number | null;
  etsyListingCount?: number | null;
  etsyAvgFavorites?: number | null;
  etsyTopFavorites?: number | null;
  googleTrendsScore?: number | null;
  pinterestSaves?: number | null;
  snapshotDate?: string; // YYYY-MM-DD; defaults to today
}

export interface VelocityResult {
  score: number;
  growth: number;
  acceleration: boolean;
}

/**
 * Inserts a velocity snapshot row for a niche on the given date.
 * Idempotent per (nicheId, snapshotDate) — if a snapshot already exists for
 * that day, we replace it so re-runs of the cron don't pile up duplicates.
 */
export async function captureNicheSnapshot(
  nicheId: string,
  signals: NicheSnapshotSignals,
): Promise<void> {
  const snapshotDate = signals.snapshotDate ?? new Date().toISOString().split("T")[0];

  // Replace any existing snapshot for the same niche/date
  await db
    .delete(nicheVelocitySnapshots)
    .where(
      and(
        eq(nicheVelocitySnapshots.nicheId, nicheId),
        eq(nicheVelocitySnapshots.snapshotDate, snapshotDate),
      ),
    );

  await db.insert(nicheVelocitySnapshots).values({
    nicheId,
    searchVolume: signals.searchVolume ?? null,
    etsyListingCount: signals.etsyListingCount ?? null,
    etsyAvgFavorites: signals.etsyAvgFavorites ?? null,
    etsyTopFavorites: signals.etsyTopFavorites ?? null,
    googleTrendsScore: signals.googleTrendsScore ?? null,
    pinterestSaves: signals.pinterestSaves ?? null,
    snapshotDate,
  });
}

/**
 * Picks the strongest available demand signal from a snapshot.
 * Order: etsyAvgFavorites (most reliable POD signal), etsyTopFavorites,
 * googleTrendsScore, searchVolume, pinterestSaves.
 */
function pickDemandSignal(snapshot: typeof nicheVelocitySnapshots.$inferSelect): number | null {
  if (snapshot.etsyAvgFavorites != null && snapshot.etsyAvgFavorites > 0) return snapshot.etsyAvgFavorites;
  if (snapshot.etsyTopFavorites != null && snapshot.etsyTopFavorites > 0) return snapshot.etsyTopFavorites;
  if (snapshot.googleTrendsScore != null && snapshot.googleTrendsScore > 0) return snapshot.googleTrendsScore;
  if (snapshot.searchVolume != null && snapshot.searchVolume > 0) return snapshot.searchVolume;
  if (snapshot.pinterestSaves != null && snapshot.pinterestSaves > 0) return snapshot.pinterestSaves;
  return null;
}

/**
 * Maps a week-over-week growth percentage to a 0-10 score.
 *   >50% WoW   -> 10
 *   25-50%     -> 8
 *   10-25%     -> 6
 *   0-10%      -> 4
 *   0% (flat)  -> 3
 *   negative   -> 1-2 (deeper decline = lower)
 */
function scoreFromGrowth(growth: number): number {
  if (growth > 50) return 10;
  if (growth >= 25) return 8;
  if (growth >= 10) return 6;
  if (growth > 0) return 4;
  if (growth === 0) return 3;
  if (growth >= -25) return 2;
  return 1;
}

/**
 * Looks at the last 4 weekly snapshots for a niche, computes WoW growth,
 * detects acceleration (3 consecutive weeks of positive growth), and
 * persists the result back onto the niches row.
 */
export async function computeVelocityScore(nicheId: string): Promise<VelocityResult> {
  const snapshots = await db
    .select()
    .from(nicheVelocitySnapshots)
    .where(eq(nicheVelocitySnapshots.nicheId, nicheId))
    .orderBy(desc(nicheVelocitySnapshots.snapshotDate))
    .limit(4)
    .all();

  // Snapshots come back newest-first; flip to oldest-first for growth math.
  const ordered = [...snapshots].reverse();

  let growth = 0;
  let score = 3; // default to "flat" when we don't have enough data
  let acceleration = false;

  if (ordered.length >= 2) {
    const previous = pickDemandSignal(ordered[ordered.length - 2]);
    const latest = pickDemandSignal(ordered[ordered.length - 1]);

    if (previous != null && previous > 0 && latest != null) {
      growth = ((latest - previous) / previous) * 100;
    }

    // Acceleration: at least 4 snapshots and the last 3 transitions all positive.
    if (ordered.length >= 4) {
      const signals = ordered.map(pickDemandSignal);
      let consecutivePositive = 0;
      for (let i = 1; i < signals.length; i++) {
        const prev = signals[i - 1];
        const curr = signals[i];
        if (prev != null && curr != null && prev > 0 && curr > prev) {
          consecutivePositive++;
        } else {
          consecutivePositive = 0;
        }
      }
      if (consecutivePositive >= 3) acceleration = true;
    }

    score = scoreFromGrowth(growth);
    if (acceleration) score = Math.min(10, score + 1);
  }

  await db
    .update(niches)
    .set({
      velocityScore: Math.round(score * 100) / 100,
      weekOverWeekGrowth: Math.round(growth * 100) / 100,
      accelerationDetected: acceleration,
      lastVelocityCheck: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    .where(eq(niches.id, nicheId));

  return { score, growth, acceleration };
}

/**
 * Captures fresh snapshots for every active/approved niche by hitting the
 * Etsy search API, then recomputes velocity scores against history.
 */
export async function captureAllActiveNiches(): Promise<{ snapshotted: number; updated: number }> {
  const activeNiches = await db
    .select()
    .from(niches)
    .where(inArray(niches.status, ["active", "approved"]))
    .all();

  if (activeNiches.length === 0) {
    return { snapshotted: 0, updated: 0 };
  }

  const keywords = activeNiches.map((n) => n.name);
  let etsyResults: Awaited<ReturnType<typeof batchValidateNiches>>;
  try {
    etsyResults = await batchValidateNiches(keywords);
  } catch (error) {
    log("error", "[Demand Velocity] Etsy batch validation failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    etsyResults = new Map();
  }

  const snapshotDate = new Date().toISOString().split("T")[0];
  let snapshotted = 0;
  let updated = 0;

  for (const niche of activeNiches) {
    const etsy = etsyResults.get(niche.name);

    try {
      await captureNicheSnapshot(niche.id, {
        searchVolume: niche.searchVolume ?? null,
        etsyListingCount: etsy?.activeListingCount ?? null,
        etsyAvgFavorites: etsy?.avgFavorites ?? null,
        // topListingSales is the highest favorites count from the search
        etsyTopFavorites: etsy?.topListingSales ?? null,
        googleTrendsScore: null,
        pinterestSaves: null,
        snapshotDate,
      });
      snapshotted++;
    } catch (error) {
      log("warn", `[Demand Velocity] Snapshot failed for "${niche.name}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      continue;
    }

    try {
      await computeVelocityScore(niche.id);
      updated++;
    } catch (error) {
      log("warn", `[Demand Velocity] Score computation failed for "${niche.name}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { snapshotted, updated };
}

/**
 * Convenience: fetch the most recent N snapshots for a niche, oldest-first.
 * Exposed for dashboards/debugging.
 */
export async function getRecentSnapshots(
  nicheId: string,
  limit = 4,
): Promise<(typeof nicheVelocitySnapshots.$inferSelect)[]> {
  const rows = await db
    .select()
    .from(nicheVelocitySnapshots)
    .where(eq(nicheVelocitySnapshots.nicheId, nicheId))
    .orderBy(desc(nicheVelocitySnapshots.snapshotDate))
    .limit(limit)
    .all();
  return rows.reverse();
}

/**
 * Convenience: count snapshots taken in the last `days` days.
 */
export async function countRecentSnapshots(days = 30): Promise<number> {
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000)
    .toISOString()
    .split("T")[0];
  const rows = await db
    .select()
    .from(nicheVelocitySnapshots)
    .where(gte(nicheVelocitySnapshots.snapshotDate, since))
    .all();
  return rows.length;
}
