import { chatCompletion } from "@/lib/ai/client";
import { claudeCompletion } from "@/lib/ai/providers";
import { ListingTagsSchema } from "@/lib/ai/schemas";
import { trackTextUsage } from "@/lib/ai/token-tracker";

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

export async function generateListingTitle(
  niche: string,
  conceptTitle: string,
  productType: string,
  maxLength: number = 140,
  pipelineRunId?: string,
): Promise<string> {
  const prompt = `Generate an Etsy listing title for a ${productType} in the "${niche}" niche.
Design concept: "${conceptTitle}"

Rules:
- Maximum ${maxLength} characters
- Front-load the most important keywords
- Include the product type naturally
- Use relevant long-tail keywords
- No ALL CAPS, no special characters
- Separate keyword groups with commas or pipes

Return ONLY the title text, nothing else.`;

  const result = await completeText(prompt, {
    systemPrompt: "You are an Etsy SEO expert. Generate optimized listing titles that rank well in Etsy search. Return ONLY the title, no explanation.",
    maxTokens: 200,
    temperature: 0.6,
  }, pipelineRunId);

  return result.content.trim().replace(/^["']|["']$/g, "").slice(0, maxLength);
}

export async function generateListingDescription(
  niche: string,
  conceptTitle: string,
  conceptDescription: string,
  productType: string,
  pipelineRunId?: string,
): Promise<string> {
  const prompt = `Write an Etsy listing description for a ${productType} design.
Niche: "${niche}"
Design: "${conceptTitle}" - ${conceptDescription}

Rules:
- Start with a hook that connects emotionally with the buyer
- Include relevant keywords naturally (not stuffed)
- Mention product details: material, print quality, sizing info
- Include a brief care instruction section
- Add a call to action
- 300-600 words
- Use short paragraphs for readability

Return ONLY the description text.`;

  const result = await completeText(prompt, {
    systemPrompt: "You are an Etsy copywriter who creates compelling product descriptions that convert browsers into buyers. Return ONLY the description, no explanation or commentary.",
    maxTokens: 1500,
    temperature: 0.7,
  }, pipelineRunId);

  return result.content.trim();
}

export async function generateListingTags(
  niche: string,
  conceptTitle: string,
  productType: string,
  maxTags: number = 13,
  pipelineRunId?: string,
): Promise<string[]> {
  const prompt = `Generate ${maxTags} Etsy tags for a ${productType} listing.
Niche: "${niche}"
Design: "${conceptTitle}"

Rules:
- Each tag max 20 characters
- Mix of broad and specific keywords
- Include: niche terms, product type, gift occasion, style descriptors
- Prioritize high-search-volume terms
- No duplicate words across tags

Return JSON: {"tags": ["tag1", "tag2", ...]}`;

  // Tags need structured output — use GPT for this (better at strict JSON)
  const result = await chatCompletion(prompt, {
    systemPrompt: "You are an Etsy SEO specialist. Generate tags that maximize search visibility.",
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

  return (result.parsed?.tags ?? []).slice(0, maxTags).map((t) => t.slice(0, 20));
}

export function calculateSEOScore(title: string, description: string, tags: string[]): number {
  let score = 0;

  if (title.length >= 100 && title.length <= 140) score += 25;
  else if (title.length >= 60) score += 15;
  else score += 5;

  const wordCount = description.split(/\s+/).length;
  if (wordCount >= 300 && wordCount <= 600) score += 25;
  else if (wordCount >= 150) score += 15;
  else score += 5;

  score += Math.min(tags.length / 13, 1) * 25;

  const allWords = tags.flatMap((t) => t.toLowerCase().split(/\s+/));
  const uniqueWords = new Set(allWords).size;
  score += Math.min(uniqueWords / 20, 1) * 25;

  return Math.round(score);
}
