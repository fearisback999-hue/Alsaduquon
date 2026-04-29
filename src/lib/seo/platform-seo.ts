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
  const prompt = `Generate a ${hints.platformName} listing title for a ${productType} in the "${niche}" niche.
Design concept: "${conceptTitle}"

Platform-specific guidance: ${hints.seoGuidance}

Rules:
- Maximum ${hints.titleMaxLength} characters
- Front-load the most important keywords
- Include the product type naturally
- Use relevant long-tail keywords
- No ALL CAPS, no special characters

Return ONLY the title text, nothing else.`;

  const result = await completeText(prompt, {
    systemPrompt: `You are a ${hints.platformName} SEO expert. Generate optimized listing titles that rank well on ${hints.platformName}. Return ONLY the title, no explanation.`,
    maxTokens: 200,
    temperature: 0.6,
  }, pipelineRunId);

  return result.content.trim().replace(/^["']|["']$/g, "").slice(0, hints.titleMaxLength);
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

Rules:
- Start with a hook that connects emotionally with the buyer
- Include relevant keywords naturally
- Mention product details: material, print quality, sizing info
- ${hints.descriptionMaxWords}-word maximum
- Use short paragraphs for readability

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

  return (result.parsed?.tags ?? []).slice(0, hints.maxTags).map((t) => t.slice(0, hints.tagMaxLength));
}

export { calculateSEOScore } from "@/lib/etsy/seo";
