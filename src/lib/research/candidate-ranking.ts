/**
 * Deterministic pre-ranking of raw niche candidates BEFORE the expensive
 * Step-2 AI scoring (two LLM calls per niche) runs.
 *
 * Step 1 can surface a long tail of candidates from trend APIs + AI expansion
 * + micro-drilling. Scoring all of them blindly burns budget on obvious
 * also-rans and lets a per-run flood crowd out the gems. This ranks every
 * candidate on the hard signals we already have for free (no API call) so the
 * pipeline can:
 *   - process the highest-potential niches FIRST, and
 *   - cap a runaway run to its best N candidates,
 * concentrating AI spend where it converts. Effective (best-first) and
 * efficient (fewer wasted scoring calls).
 */

export interface RankableCandidate {
  keyword: string;
  searchVolume: number;
  /** 0-1, where 1 = most saturated. */
  competition: number;
  trendDirection?: string | null;
  source?: string | null;
}

const TREND_WEIGHT: Record<string, number> = {
  explosive: 1.0,
  up: 0.85,
  growing: 0.85,
  stable: 0.55,
  flat: 0.55,
  down: 0.2,
  declining: 0.2,
};

/**
 * Scores a candidate 0-100 on demand, openness, momentum, and specificity.
 * Long-tail / micro-drilled niches get credit because specific buyer-intent
 * phrases convert far above broad head terms even at lower raw volume.
 */
export function scoreCandidate(c: RankableCandidate): number {
  // Demand: log-scaled so 1k→0.75, 10k→1.0; volume is often unknown (0) for
  // AI-expanded / micro-drilled seeds, which then lean on the other factors.
  const vol = Math.max(0, c.searchVolume ?? 0);
  const demand = vol > 0 ? Math.min(1, Math.log10(vol + 1) / 4) : 0;

  // Openness: lower competition is better (1 = wide-open market).
  const openness = 1 - Math.min(1, Math.max(0, c.competition ?? 0.5));

  // Momentum: a growing/explosive trend outranks a declining one.
  const momentum = TREND_WEIGHT[(c.trendDirection ?? "stable").toLowerCase()] ?? 0.55;

  // Specificity: multi-word long-tail (1 word → 0, 4+ words → 1).
  const wordCount = c.keyword.trim().split(/\s+/).filter(Boolean).length;
  const longTail = Math.min(1, Math.max(0, wordCount - 1) / 3);

  // Micro-drilled candidates are persona×occasion×style tuples — the highest
  // intent we generate — so they earn a flat bonus over raw trend keywords.
  const micro = c.source === "micro_drill" ? 1 : 0;

  const score =
    demand * 30 +
    openness * 25 +
    momentum * 20 +
    longTail * 15 +
    micro * 10;

  return Math.round(score * 10) / 10;
}

/**
 * Returns the candidates sorted best-first. Stable for equal scores (keeps the
 * original relative order, which favors earlier/higher-signal sources).
 */
export function rankCandidates<T extends RankableCandidate>(candidates: T[]): T[] {
  return candidates
    .map((c, i) => ({ c, i, s: scoreCandidate(c) }))
    .sort((a, b) => (b.s - a.s) || (a.i - b.i))
    .map((x) => x.c);
}
