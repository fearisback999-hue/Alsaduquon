import { dedupeTags } from "./platform-seo";

/**
 * Deterministic Etsy-SEO finishing pass applied AFTER the LLM has written the
 * raw title variants, description, and tags.
 *
 * The model writes good copy but applies Etsy's ranking levers inconsistently —
 * sometimes it front-loads the head keyword, sometimes not; sometimes it uses
 * all 13 tags, sometimes 9; it rarely mirrors title phrases into tags. Those
 * levers are mechanical and well understood, so we encode them here and apply
 * them every time. The result is the consistency a top-1% human seller has but
 * can't sustain across hundreds of listings:
 *
 *   1. Pick the title variant that best satisfies Etsy's title rubric
 *      (head keyword in the first ~40 chars, full length utilization,
 *      multi-phrase structure, a buyer-intent token, no keyword stuffing).
 *   2. Mirror the chosen title's multi-word phrases into the tag set — Etsy's
 *      search explicitly rewards exact title↔tag matches.
 *   3. Backfill every one of the 13 tag slots with distinct buyer-intent
 *      long-tail phrases (niche × persona × occasion × product), because an
 *      unused tag slot is free ranking surface left on the table.
 *
 * Pure / synchronous / side-effect-free so it's trivially testable and adds
 * zero latency or cost to the pipeline.
 */

export interface EtsySeoInput {
  niche: string;
  conceptTitle: string;
  /** Human display name of the product, e.g. "Unisex T-Shirt", "Ceramic Mug". */
  productType: string;
  titleVariants: string[];
  tags: string[];
  buyerPersona?: string | null;
  occasion?: string | null;
  maxTitleLength: number;
  maxTags: number;
  maxTagLength: number;
}

export interface EtsySeoResult {
  /** Best title variant, reordered to the front of `titleVariants`. */
  title: string;
  titleVariants: string[];
  tags: string[];
  /** 0-100 rubric score for the chosen title (for logging / A-B telemetry). */
  titleScore: number;
  rationale: string[];
}

// Buyer-intent signals: the words shoppers actually type alongside a niche.
// Presence of at least one is what separates a discoverable title from a
// purely descriptive one.
const INTENT_TOKEN =
  /\b(gift|gifts|for him|for her|for men|for women|for mom|for dad|for kids|for wife|for husband|funny|cute|vintage|retro|aesthetic|lover|mama|papa|birthday|christmas|custom|personalized|matching)\b/i;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "of", "to", "with", "in", "on", "my",
  "your", "this", "that", "&", "|",
]);

function words(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function significantWords(s: string): string[] {
  return words(s).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

/**
 * Scores a single title against Etsy's ranking levers. 0-100.
 * The components are additive and independent so the rationale is legible.
 */
export function scoreTitle(
  title: string,
  niche: string,
  maxTitleLength: number,
): { score: number; reasons: string[] } {
  const reasons: string[] = [];
  let score = 0;

  // 1. Length sweet spot (30): 70%+ of Etsy purchases are mobile where only
  // ~70 chars display. Best titles pack primary keywords in 60-80 chars and
  // use the rest (up to 140) for secondary search terms.
  if (title.length >= 60 && title.length <= 100) { score += 30; reasons.push("mobile-optimized length"); }
  else if (title.length >= 45 && title.length <= 140) { score += 20; reasons.push("acceptable length"); }
  else { score += 8; reasons.push("title too short or too long for mobile"); }

  // 2. Head-keyword front-loading (25): the most weight is on the first ~40
  // chars, so the niche's primary word should appear there.
  const head = title.toLowerCase().slice(0, 45);
  const nicheWords = significantWords(niche);
  const inFirst25 = nicheWords.some((w) => title.toLowerCase().slice(0, 25).includes(w));
  const inFirst45 = nicheWords.some((w) => head.includes(w));
  if (inFirst25) { score += 25; reasons.push("head keyword front-loaded"); }
  else if (inFirst45) { score += 15; reasons.push("head keyword near front"); }
  else if (nicheWords.some((w) => title.toLowerCase().includes(w))) { score += 8; reasons.push("head keyword present but buried"); }
  else { reasons.push("head keyword missing"); }

  // 3. Multi-phrase structure (15): separators pack several search phrases into
  // one title, each independently indexable.
  const phraseCount = title.split(/[|,]/).map((p) => p.trim()).filter(Boolean).length;
  if (phraseCount >= 3) { score += 15; reasons.push(`${phraseCount} keyword phrases`); }
  else if (phraseCount === 2) { score += 10; reasons.push("2 keyword phrases"); }
  else { score += 3; reasons.push("single-phrase title"); }

  // 4. Buyer intent (15): a discoverable title names the gift/recipient/style.
  if (INTENT_TOKEN.test(title)) { score += 15; reasons.push("buyer-intent token present"); }
  else { reasons.push("no buyer-intent token"); }

  // 5. Not keyword-stuffed (15): Etsy penalizes spam; no significant word
  // should repeat more than twice.
  const counts = new Map<string, number>();
  for (const w of significantWords(title)) counts.set(w, (counts.get(w) ?? 0) + 1);
  const maxRepeat = Math.max(0, ...Array.from(counts.values()));
  if (maxRepeat <= 2) { score += 15; reasons.push("clean keyword diversity"); }
  else if (maxRepeat === 3) { score += 7; reasons.push("mild keyword repetition"); }
  else { reasons.push("keyword stuffed"); }

  return { score, reasons };
}

/** Trims a phrase to fit `maxLen` by dropping trailing whole words. */
function fitTag(phrase: string, maxLen: number): string | null {
  let t = phrase.trim().replace(/\s+/g, " ");
  if (!t) return null;
  if (t.length <= maxLen) return t;
  const parts = t.split(" ");
  while (parts.length > 1) {
    parts.pop();
    t = parts.join(" ");
    if (t.length <= maxLen) return t;
  }
  return null; // a single word longer than the limit is unusable as a tag
}

/** Multi-word phrases lifted from the chosen title — the title↔tag mirror. */
function extractTitlePhrases(title: string, maxLen: number): string[] {
  return title
    .split(/[|,]/)
    .map((s) => s.trim().toLowerCase().replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .map((s) => fitTag(s, maxLen))
    .filter((s): s is string => !!s && s.split(" ").length >= 2);
}

/** A short, tag-friendly noun for the product ("Unisex T-Shirt" → "t-shirt"). */
function productNoun(productType: string): string {
  const cleaned = productType
    .toLowerCase()
    .replace(/\b(unisex|classic|premium|ceramic|cotton|soft|cozy)\b/g, "")
    .trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);
  return parts.length ? parts[parts.length - 1] : productType.toLowerCase();
}

/**
 * Synthesizes buyer-intent long-tail phrases to fill any empty tag slots, in
 * descending order of value. All phrases are product-agnostic except the one
 * built from the actual product noun, so a mug listing never gets a "shirt"
 * tag. Internally de-duped so the caller gets a clean surplus to draw from.
 */
function synthesizeTags(
  niche: string,
  persona: string | null | undefined,
  occasion: string | null | undefined,
  productType: string,
  maxLen: number,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (p?: string | null) => {
    if (!p) return;
    const f = fitTag(p, maxLen);
    if (f && !seen.has(f.toLowerCase())) { seen.add(f.toLowerCase()); out.push(f); }
  };
  const n = niche.toLowerCase().trim();
  const noun = productNoun(productType);
  const p = persona?.toLowerCase().trim();
  const o = occasion?.toLowerCase().trim();

  // Tier 1 — highest intent (gift + recipient + occasion).
  push(`${n} gift`);
  push(`${n} ${noun}`);
  if (p) { push(`gift for ${p}`); push(`${p} gift`); }
  if (o) { push(`${o} gift`); push(`${n} ${o}`); }
  // Tier 2 — gift phrasings shoppers actually type (product-agnostic).
  push(`${n} present`);
  push(`${n} lover gift`);
  push(`${n} lover`);
  push(`${n} gift idea`);
  if (p) push(`${p} ${noun}`);
  // Tier 3 — style modifiers: common Etsy long-tail prefixes.
  push(`funny ${n}`);
  push(`cute ${n}`);
  push(`vintage ${n}`);
  // Tier 4 — bare niche, as a last-resort multi-word phrase.
  push(n);
  return out;
}

export function optimizeEtsyListing(input: EtsySeoInput): EtsySeoResult {
  const {
    niche, productType, titleVariants, tags,
    buyerPersona, occasion, maxTitleLength, maxTags, maxTagLength,
  } = input;

  // Fall back to a derived title if the generator returned nothing usable.
  const candidates = titleVariants.filter((t) => t && t.trim().length > 0);
  const safeCandidates = candidates.length > 0
    ? candidates
    : [`${input.conceptTitle} ${productType}`.slice(0, maxTitleLength)];

  // 1. Choose the highest-rubric title.
  let best = safeCandidates[0];
  let bestScore = -1;
  let bestReasons: string[] = [];
  for (const t of safeCandidates) {
    const { score, reasons } = scoreTitle(t, niche, maxTitleLength);
    if (score > bestScore) { best = t; bestScore = score; bestReasons = reasons; }
  }

  // 2 + 3. Build the tag set: title-mirror phrases first (highest SEO value),
  // then the model's tags, then synthesized backfill so all 13 slots are used.
  const ordered = [
    ...extractTitlePhrases(best, maxTagLength),
    ...tags,
    ...synthesizeTags(niche, buyerPersona, occasion, productType, maxTagLength),
  ];
  const fitted = ordered
    .map((t) => fitTag(t, maxTagLength))
    .filter((t): t is string => !!t);
  const finalTags = dedupeTags(fitted, maxTags);

  const orderedVariants = [best, ...safeCandidates.filter((t) => t !== best)];

  return {
    title: best,
    titleVariants: orderedVariants,
    tags: finalTags,
    titleScore: bestScore,
    rationale: bestReasons,
  };
}
