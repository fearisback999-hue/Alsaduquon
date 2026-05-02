import { chatCompletion } from "@/lib/ai/client";
import { claudeCompletion } from "@/lib/ai/providers";
import { ListingTagsSchema } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import type { PlatformSEOHints } from "@/lib/platforms/types";

const useClaude = () => !!process.env.ANTHROPIC_API_KEY;

async function completeText(prompt: string, opts: { systemPrompt: string; maxTokens: number; temperature: number }, pipelineRunId?: string) {
  if (useClaude()) {
    const result = await claudeCompletion(prompt, {
      systemPrompt: opts.systemPrompt,
      maxTokens: opts.maxTokens,
      temperature: opts.temperature,
    });
    await trackTextUsage({
      model: result.model,
      operation: "seo_text",
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      pipelineRunId,
      provider: "anthropic",
    });
    return result;
  }
  const result = await chatCompletion(prompt, {
    systemPrompt: opts.systemPrompt,
    maxTokens: opts.maxTokens,
    temperature: opts.temperature,
  });
  await trackTextUsage({
    model: result.model,
    operation: "seo_text",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pipelineRunId,
  });
  return result;
}

export async function generatePlatformTitle(
  niche: string,
  conceptTitle: string,
  productType: string,
  hints: PlatformSEOHints,
  pipelineRunId?: string,
): Promise<string> {
  const variants = await generatePlatformTitleVariants(niche, conceptTitle, productType, hints, pipelineRunId);
  return variants[0];
}

/**
 * Generates 3 distinct title variants written by an expert POD copywriter.
 * Picks the first one for publish; downstream A/B systems can rotate to the
 * others. Includes concrete examples in the prompt and forbids generic
 * "Niche T-Shirt for Niche Lovers" patterns.
 */
export async function generatePlatformTitleVariants(
  niche: string,
  conceptTitle: string,
  productType: string,
  hints: PlatformSEOHints,
  pipelineRunId?: string,
): Promise<string[]> {
  const prompt = `Generate 3 distinct ${hints.platformName} listing titles for a ${productType} in the "${niche}" niche.
Design concept: "${conceptTitle}"

Platform-specific guidance: ${hints.seoGuidance}

EXAMPLES of strong titles (learn the structure, do not copy):
- "Funny Cat Mom T-Shirt | Crazy Cat Lady Gift | Cute Kitten Lover Tee for Women"
- "Mama Bear Hoodie | Mother's Day Gift for Mom | Cozy Bear Pullover for New Moms"
- "Vintage Sunset Wave Poster | Retro Beach Wall Art | Aesthetic Surf Print Decor"

Each variant must:
- Stay under ${hints.titleMaxLength} characters
- Use a different opening keyword (not all 3 starting with the same word)
- Mix discovery keywords (product type, niche) with intent keywords (gift, for women, funny, cute, aesthetic)
- Name the buyer persona or occasion when natural ("for new moms", "for dog dads", "Mother's Day")
- Read like a thoughtful human listing — not generic SEO stuffing
- Avoid the pattern "[Niche] [Product] for [Niche] Lovers"

Return JSON: {"titles": ["title1", "title2", "title3"]}`;

  const result = await chatCompletion(prompt, {
    systemPrompt: `You are a ${hints.platformName} copywriter who has personally driven millions in POD revenue. Your titles rank AND convert. Return ONLY JSON.`,
    maxTokens: 600,
    temperature: 0.75,
  });

  await trackTextUsage({
    model: result.model,
    operation: "seo_title_variants",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pipelineRunId,
  });

  let titles: string[] = [];
  try {
    const match = result.content.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      titles = Array.isArray(parsed.titles) ? parsed.titles : [];
    }
  } catch { /* ignore */ }

  const cleaned = titles
    .map((t) => String(t).trim().replace(/^["']|["']$/g, "").slice(0, hints.titleMaxLength))
    .filter((t) => t.length > 0);

  if (cleaned.length === 0) {
    return [`${conceptTitle} ${productType}`.slice(0, hints.titleMaxLength)];
  }

  return cleaned;
}

export async function generatePlatformDescription(
  niche: string,
  conceptTitle: string,
  conceptDescription: string,
  productType: string,
  hints: PlatformSEOHints,
  pipelineRunId?: string,
): Promise<string> {
  const prompt = `Write a ${hints.platformName} listing description for a ${productType} design.
Niche: "${niche}"
Design: "${conceptTitle}" - ${conceptDescription}

Platform-specific guidance: ${hints.seoGuidance}

STRUCTURE (follow this order):
1. EMOTIONAL HOOK (1-2 lines) — speak to who this person IS, what they love, the moment they'll wear/use this
2. PRODUCT DETAILS — premium feel: material quality, print method, durability ("ultra-soft cotton", "fade-resistant DTG print", "true-to-size fit")
3. WHO IT'S FOR — gift occasions, recipient personas (give 2-3 specific examples)
4. CARE / LOGISTICS — wash instructions if apparel, dishwasher/microwave safe if mug, ships in 3-5 business days, packaged with care

TONE: warm, confident, specific. Avoid AI-tells like "elevate your style", "make a statement",
"stand out from the crowd". Use concrete sensory language ("buttery-soft", "crisp print",
"saturated colors that don't crack").

Rules:
- ${hints.descriptionMaxWords}-word maximum
- Short paragraphs (2-3 lines each)
- Include relevant keywords naturally — never stuff
- No emojis unless the niche demands it (kawaii, cute, aesthetic niches OK)

Return ONLY the description text.`;

  const result = await completeText(prompt, {
    systemPrompt: `You are a ${hints.platformName} copywriter who creates compelling product descriptions that convert browsers into buyers. Return ONLY the description, no explanation.`,
    maxTokens: 1500,
    temperature: 0.7,
  }, pipelineRunId);

  return result.content.trim();
}

export async function generatePlatformTags(
  niche: string,
  conceptTitle: string,
  productType: string,
  hints: PlatformSEOHints,
  pipelineRunId?: string,
): Promise<string[]> {
  if (hints.maxTags === 0) return [];

  const prompt = `Generate ${hints.maxTags} ${hints.platformName} tags for a ${productType} listing.
Niche: "${niche}"
Design: "${conceptTitle}"

Rules:
- Each tag max ${hints.tagMaxLength} characters
- Mix of broad and specific keywords
- Include: niche terms, product type, gift occasion, style descriptors
- Prioritize high-search-volume terms

Return JSON: {"tags": ["tag1", "tag2", ...]}`;

  const result = await chatCompletion(prompt, {
    systemPrompt: `You are a ${hints.platformName} SEO specialist. Generate tags that maximize search visibility.`,
    maxTokens: 300,
    temperature: 0.5,
    schema: ListingTagsSchema,
    schemaName: "listing_tags",
  });

  await trackTextUsage({
    model: result.model,
    operation: "seo_tags",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pipelineRunId,
  });

  const raw = (result.parsed?.tags ?? []).map((t) => t.slice(0, hints.tagMaxLength));
  return dedupeTags(raw, hints.maxTags);
}

/**
 * Semantic tag dedup — strips plurals, removes substring overlaps, and
 * collapses near-duplicates so we don't burn 4 of 13 Etsy tag slots on
 * "cat", "cats", "kitten", "kittens".
 */
export function dedupeTags(tags: string[], maxCount: number): string[] {
  const normalize = (t: string) => t.toLowerCase().trim().replace(/\s+/g, " ");
  const stem = (t: string) => {
    const n = normalize(t);
    // Strip simple plural / possessive suffixes
    if (n.endsWith("ies") && n.length > 4) return n.slice(0, -3) + "y";
    if (n.endsWith("es") && n.length > 3) return n.slice(0, -2);
    if (n.endsWith("s") && n.length > 2 && !n.endsWith("ss")) return n.slice(0, -1);
    return n;
  };

  const seenStems = new Set<string>();
  const result: string[] = [];

  for (const tag of tags) {
    if (!tag) continue;
    const trimmed = tag.trim();
    if (trimmed.length === 0) continue;

    const tagStem = stem(trimmed);
    if (seenStems.has(tagStem)) continue;

    // Reject if this tag is a strict substring of an already-kept tag
    const isSubstringOfExisting = result.some((existing) => {
      const e = normalize(existing);
      const t = normalize(trimmed);
      return e !== t && e.includes(t);
    });
    if (isSubstringOfExisting) continue;

    // Reject if an already-kept tag is a strict substring of this one — replace it instead
    const supersededIdx = result.findIndex((existing) => {
      const e = normalize(existing);
      const t = normalize(trimmed);
      return e !== t && t.includes(e);
    });
    if (supersededIdx >= 0) {
      result[supersededIdx] = trimmed;
      seenStems.add(tagStem);
      continue;
    }

    seenStems.add(tagStem);
    result.push(trimmed);
    if (result.length >= maxCount) break;
  }

  return result;
}

export function calculateSEOScore(
  title: string,
  description: string,
  tags: string[],
  hints?: PlatformSEOHints,
): number {
  const maxTitle = hints?.titleMaxLength ?? 140;
  const maxWords = hints?.descriptionMaxWords ?? 600;
  const maxTags = hints?.maxTags ?? 13;

  let score = 0;

  const titleRatio = maxTitle > 0 ? title.length / maxTitle : 1;
  if (titleRatio >= 0.7 && titleRatio <= 1.0) score += 25;
  else if (titleRatio >= 0.4) score += 15;
  else score += 5;

  const wordCount = description.split(/\s+/).length;
  const wordRatio = maxWords > 0 ? wordCount / maxWords : 1;
  if (wordRatio >= 0.5 && wordRatio <= 1.0) score += 25;
  else if (wordRatio >= 0.25) score += 15;
  else score += 5;

  if (maxTags > 0) {
    score += Math.min(tags.length / maxTags, 1) * 25;
  } else {
    score += 25;
  }

  const allWords = tags.flatMap((t) => t.toLowerCase().split(/\s+/));
  const uniqueWords = new Set(allWords).size;
  score += Math.min(uniqueWords / 20, 1) * 25;

  return Math.round(score);
}
