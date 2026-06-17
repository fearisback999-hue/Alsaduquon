import { getActiveSeasons, type Season } from "./seasonal-calendar";

interface SeasonalRunDecision {
  shouldRunExtra: boolean;
  reason: string;
  activeSeason: Season | null;
  daysUntilPeak: number | null;
}

/**
 * Determines if the pipeline should run an extra time today due to
 * upcoming seasonal demand. POD shops earn 40-60% of annual revenue
 * during seasonal spikes — we need higher listing volume during prep windows.
 *
 * Strategy:
 * - Inside a high-boost season (Christmas, Halloween, Valentine's, Mother's Day):
 *   trigger extra runs to maximize listing volume during the window.
 * - High-boost seasons get up to 3 runs/day during peak prep (45-15 days before).
 * - Medium-boost seasons get 2 runs/day during peak prep.
 */
export function evaluateSeasonalUrgency(now: Date = new Date()): SeasonalRunDecision {
  const activeSeasons = getActiveSeasons(now);

  if (activeSeasons.length === 0) {
    return {
      shouldRunExtra: false,
      reason: "No active seasonal windows",
      activeSeason: null,
      daysUntilPeak: null,
    };
  }

  // Pick the highest-boost active season
  const topSeason = activeSeasons.reduce((max, s) => (s.scoreBoost > max.scoreBoost ? s : max));
  const daysUntilPeak = daysUntilPrepEnd(now, topSeason);

  // High-boost seasons (Christmas 1.5, Halloween 1.2, Valentine's 1.0, Mother's Day 1.0)
  if (topSeason.scoreBoost >= 1.0 && daysUntilPeak >= 14 && daysUntilPeak <= 60) {
    return {
      shouldRunExtra: true,
      reason: `${topSeason.name} prep window: ${daysUntilPeak} days until peak`,
      activeSeason: topSeason,
      daysUntilPeak,
    };
  }

  // Medium-boost seasons (Father's Day 0.8, Back to School 0.8) — only push during sweet spot
  if (topSeason.scoreBoost >= 0.7 && daysUntilPeak >= 21 && daysUntilPeak <= 45) {
    return {
      shouldRunExtra: true,
      reason: `${topSeason.name} prep window: ${daysUntilPeak} days until peak`,
      activeSeason: topSeason,
      daysUntilPeak,
    };
  }

  return {
    shouldRunExtra: false,
    reason: `${topSeason.name} active but outside push window (${daysUntilPeak}d)`,
    activeSeason: topSeason,
    daysUntilPeak,
  };
}

function daysUntilPrepEnd(now: Date, season: Season): number {
  const year = now.getFullYear();
  let endDate = new Date(year, season.prepEnd.month - 1, season.prepEnd.day);

  // If prep end already passed this year, it's next year's window
  if (endDate < now) {
    endDate = new Date(year + 1, season.prepEnd.month - 1, season.prepEnd.day);
  }

  return Math.ceil((endDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000));
}
