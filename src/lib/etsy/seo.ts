import { chatCompletion } from "@/lib/ai/client";
import { trackTextUsage } from "@/lib/ai/token-tracker";

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

  const result = await chatCompletion(prompt, {
    systemPrompt: "You are an Etsy SEO expert. Generate optimized listing titles that rank well in Etsy search.",
    maxTokens: 200,
    temperature: 0.6,
  });

  await trackTextUsage({
    model: result.model,
    operation: "seo_title",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pipelineRunId,
  });

  return result.content.trim().slice(0, maxLength);
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

  const result = await chatCompletion(prompt, {
    systemPrompt: "You are an Etsy copywriter who creates compelling product descriptions that convert browsers into buyers.",
    maxTokens: 1500,
    temperature: 0.7,
  });

  await trackTextUsage({
    model: result.model,
    operation: "seo_description",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pipelineRunId,
  });

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

Return a JSON array of strings, e.g. ["tag1", "tag2", ...]`;

  const result = await chatCompletion(prompt, {
    systemPrompt: "You are an Etsy SEO specialist. Generate tags that maximize search visibility.",
    maxTokens: 300,
    temperature: 0.5,
    jsonMode: true,
  });

  await trackTextUsage({
    model: result.model,
    operation: "seo_tags",
    inputTokens: result.inputTokens,
    outputTokens: result.outputTokens,
    pipelineRunId,
  });

  try {
    const parsed = JSON.parse(result.content);
    const tags = Array.isArray(parsed) ? parsed : parsed.tags ?? [];
    return tags.slice(0, maxTags).map((t: string) => t.slice(0, 20));
  } catch {
    return result.content.split(",").map((t) => t.trim().slice(0, 20)).slice(0, maxTags);
  }
}

export function calculateSEOScore(title: string, description: string, tags: string[]): number {
  let score = 0;

  // Title length (optimal: 100-140 chars)
  if (title.length >= 100 && title.length <= 140) score += 25;
  else if (title.length >= 60) score += 15;
  else score += 5;

  // Description length (optimal: 300-600 words)
  const wordCount = description.split(/\s+/).length;
  if (wordCount >= 300 && wordCount <= 600) score += 25;
  else if (wordCount >= 150) score += 15;
  else score += 5;

  // Tags count (max 13)
  score += Math.min(tags.length / 13, 1) * 25;

  // Tag diversity (unique words across tags)
  const allWords = tags.flatMap((t) => t.toLowerCase().split(/\s+/));
  const uniqueWords = new Set(allWords).size;
  score += Math.min(uniqueWords / 20, 1) * 25;

  return Math.round(score);
}
