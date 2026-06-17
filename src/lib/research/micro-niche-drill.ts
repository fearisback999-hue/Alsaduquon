import { chatCompletion } from "@/lib/ai/client";
import { claudeCompletion } from "@/lib/ai/providers";
import { MicroNicheDrillSchema } from "@/lib/ai/schemas";
import { sanitizeForPrompt } from "@/lib/ai/sanitize";
import { trackTextUsage } from "@/lib/ai/token-tracker";
import { enforcebudget } from "@/lib/cost/guard";
import { log } from "@/lib/logger";

/**
 * Micro-niche drilling: decompose a broad niche into ultra-specific
 * BUYER IDENTITY x OCCASION x STYLE tuples that map to long-tail searchable
 * Etsy phrases. Replaces shallow keyword expansion with deep buyer-persona
 * thinking — the kind of phrases that have FAR less competition than
 * "funny cat shirt" but real demand from a well-defined audience.
 */
export interface MicroNiche {
  keyword: string;        // The full searchable phrase
  buyerPersona: string;   // Who would buy this
  occasion: string;       // Birthday, retirement, mother's day, just-because, identity-pride
  style: string;          // Funny, cute, vintage, goth, minimalist, etc
  confidence: number;     // 0-1, AI's confidence this micro-niche has demand
}

const SYSTEM_PROMPT = `You are an Etsy print-on-demand market researcher who specializes in finding ultra-specific micro-niches that big sellers ignore. You think in BUYER IDENTITY x OCCASION x STYLE tuples — never generic keywords. Your job is to imagine real, specific people with real, specific reasons to buy a t-shirt, mug, hoodie, or poster, then describe the exact phrase they'd type into Etsy's search bar.`;

function buildPrompt(broadNiche: string, count: number): string {
  const safeNiche = sanitizeForPrompt(broadNiche);
  const target = Math.min(Math.max(count, 1), 15);

  return `BROAD NICHE TO DRILL: "${safeNiche}"

TARGET: produce ${target} distinct micro-niches.

==========================================================
THE FRAMEWORK YOU MUST USE: PERSONA -> OCCASION -> STYLE -> KEYWORD
==========================================================

Do NOT generate surface-level keyword variations like "cute cat shirt" or
"kitten lover shirt". Those are dead. Instead, think like a marketer
profiling a real buyer:

STEP 1 — BRAINSTORM 3-5 DISTINCT BUYER PERSONAS who would love a POD product
in this niche. For each persona, picture:
  - Demographics (age range, gender if relevant, life stage)
  - Interests / subculture / fandom
  - Life situation (new mom, retiring, just got engaged, in grad school, etc.)
  - What identity they want to broadcast

STEP 2 — For each persona, pick 1-2 OCCASIONS they would buy a POD product:
  - Gift-buying: birthday, mother's day, father's day, retirement, graduation,
    anniversary, christmas, valentine's day, baby shower
  - Self-purchase: identity-pride, just-because, new-hobby, milestone,
    "treat yourself", group/club uniform
  - Event: bachelorette, bachelor party, family reunion, vacation, concert

STEP 3 — Layer a distinctive STYLE / AESTHETIC the persona resonates with:
  funny, sarcastic, cute, minimalist, vintage retro, goth dark, cottagecore,
  y2k, dark academia, boho, pastel, grunge, kawaii, motivational, typographic,
  watercolor, line-art, 70s groovy, 90s nostalgia, etc.

STEP 4 — Combine into a long-tail KEYWORD: a 3-7 word phrase a real buyer
would actually type into Etsy. It should feel natural, not stuffed.

==========================================================
CONCRETE EXAMPLES (study these — match this depth)
==========================================================

Broad niche: "cat"
  - persona: cat-dad, retired blue-collar man who finally adopted a tabby
    occasion: retirement gift from his kids
    style: funny vintage typography
    keyword: "tabby cat dad retirement gift tee"

  - persona: millennial cat-mom into pastel cottagecore
    occasion: mother's day
    style: cute pastel watercolor
    keyword: "calico cat mom mother's day shirt"

  - persona: gen-z goth black-cat owner with a witchy aesthetic
    occasion: identity-pride / just-because
    style: dark goth aesthetic
    keyword: "black cat witchy goth aesthetic tee"

Broad niche: "coffee"
  - persona: night-shift ER nurse who lives on caffeine
    occasion: nurse-week appreciation gift
    style: sarcastic funny typography
    keyword: "night shift nurse coffee survival mug"

  - persona: dad-to-be who's been told sleep is over
    occasion: baby shower / new dad gift
    style: dad-joke retro
    keyword: "new dad coffee and naps shirt"

Broad niche: "plants"
  - persona: 30-something apartment-dwelling plant collector with too many
    monsteras
    occasion: just-because / identity-pride
    style: minimalist line-art
    keyword: "crazy plant lady monstera line art tee"

==========================================================
RULES
==========================================================
- Each keyword should be 3-7 words, lowercase, natural-sounding.
- Each persona must be SPECIFIC, not generic ("retired blue-collar cat dad",
  not just "cat lover").
- Each occasion must be a real gifting or self-purchase moment.
- Each style must be a recognizable aesthetic (not just "nice" or "cool").
- Confidence (0-1): your honest estimate of whether this micro-niche has real
  Etsy demand. 0.9+ = obvious gift category, 0.5 = niche but real audience,
  <0.5 = creative shot.
- Avoid the broad niche keyword as-is.
- Avoid oversaturated phrases ("funny cat shirt", "live laugh love").
- Each of the ${target} micro-niches must have a DIFFERENT persona/occasion/
  style combination — no variants of the same idea.

Return JSON matching exactly:
{
  "micro_niches": [
    {
      "keyword": "...",
      "buyer_persona": "...",
      "occasion": "...",
      "style": "...",
      "confidence": 0.0
    }
  ]
}`;
}

export async function drillMicroNiches(
  broadNiche: string,
  count: number = 5,
  pipelineRunId?: string,
): Promise<MicroNiche[]> {
  if (!broadNiche || broadNiche.trim().length === 0) return [];

  await enforcebudget(0.02);

  const prompt = buildPrompt(broadNiche, count);
  const useClaude = !!process.env.ANTHROPIC_API_KEY;

  try {
    let parsed: { micro_niches: Array<{ keyword: string; buyer_persona: string; occasion: string; style: string; confidence: number }> } | null;
    let model: string;
    let inputTokens: number;
    let outputTokens: number;

    if (useClaude) {
      const result = await claudeCompletion(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        schema: MicroNicheDrillSchema,
        maxTokens: 2000,
        temperature: 0.85,
      });
      parsed = result.parsed;
      model = result.model;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    } else {
      const result = await chatCompletion(prompt, {
        systemPrompt: SYSTEM_PROMPT,
        schema: MicroNicheDrillSchema,
        schemaName: "micro_niche_drill",
        maxTokens: 2000,
        temperature: 0.85,
      });
      parsed = result.parsed;
      model = result.model;
      inputTokens = result.inputTokens;
      outputTokens = result.outputTokens;
    }

    await trackTextUsage({
      model,
      operation: "micro_niche_drill",
      inputTokens,
      outputTokens,
      pipelineRunId,
    });

    const items = parsed?.micro_niches ?? [];
    log(
      "info",
      `[micro-drill] Drilled "${broadNiche}" -> ${items.length} micro-niches via ${useClaude ? "claude" : "gpt"}`,
    );

    return items.map((m) => ({
      keyword: m.keyword.toLowerCase().trim(),
      buyerPersona: m.buyer_persona,
      occasion: m.occasion,
      style: m.style,
      confidence: m.confidence,
    }));
  } catch (error) {
    log("error", `[micro-drill] drilling failed for "${broadNiche}"`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}
