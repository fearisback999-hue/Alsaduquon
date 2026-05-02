import Anthropic from "@anthropic-ai/sdk";
import Replicate from "replicate";
import type { z } from "zod";

// ============================================================
// ANTHROPIC (CLAUDE) — creative text, listing copy, concepts
// ============================================================

const globalForAnthropic = globalThis as unknown as { anthropic: Anthropic | undefined };

function getAnthropic(): Anthropic {
  if (globalForAnthropic.anthropic) return globalForAnthropic.anthropic;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  if (process.env.NODE_ENV !== "production") globalForAnthropic.anthropic = client;
  return client;
}

interface ClaudeCompletionOptions<T> {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  schema?: z.ZodType<T>;
}

interface ClaudeCompletionResult<T> {
  content: string;
  parsed: T | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export async function claudeCompletion<T = unknown>(
  prompt: string,
  options?: ClaudeCompletionOptions<T>,
): Promise<ClaudeCompletionResult<T>> {
  const anthropic = getAnthropic();
  const model = options?.model ?? "claude-sonnet-4-6";

  const response = await anthropic.messages.create({
    model,
    max_tokens: options?.maxTokens ?? 4000,
    temperature: options?.temperature ?? 0.7,
    ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
    messages: [{ role: "user", content: prompt }],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";

  let parsed: T | null = null;
  if (options?.schema) {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new ClaudeStructuredOutputError("No JSON object found in Claude response", content);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(jsonMatch[0]);
    } catch (err) {
      throw new ClaudeStructuredOutputError(
        `JSON parse failed: ${err instanceof Error ? err.message : String(err)}`,
        content,
      );
    }
    const result = options.schema.safeParse(raw);
    if (!result.success) {
      throw new ClaudeStructuredOutputError(
        `Schema validation failed: ${result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
        content,
      );
    }
    parsed = result.data;
  }

  return {
    content,
    parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

export class ClaudeStructuredOutputError extends Error {
  constructor(message: string, public readonly rawContent: string) {
    super(message);
    this.name = "ClaudeStructuredOutputError";
  }
}

export async function claudeAnalyzeImage<T = unknown>(
  imageUrl: string,
  prompt: string,
  options?: ClaudeCompletionOptions<T>,
): Promise<ClaudeCompletionResult<T>> {
  const anthropic = getAnthropic();
  const model = options?.model ?? "claude-sonnet-4-6";

  const response = await anthropic.messages.create({
    model,
    max_tokens: options?.maxTokens ?? 500,
    temperature: options?.temperature ?? 0.3,
    ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
    messages: [
      {
        role: "user",
        content: [
          { type: "image", source: { type: "url", url: imageUrl } },
          { type: "text", text: prompt },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : "";

  let parsed: T | null = null;
  if (options?.schema) {
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const raw = JSON.parse(jsonMatch[0]);
        const result = options.schema.safeParse(raw);
        if (result.success) parsed = result.data;
      }
    } catch { /* ignore */ }
  }

  return {
    content,
    parsed,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    model,
  };
}

// ============================================================
// REPLICATE (FLUX) — image generation
// ============================================================

const globalForReplicate = globalThis as unknown as { replicate: Replicate | undefined };

function getReplicate(): Replicate {
  if (globalForReplicate.replicate) return globalForReplicate.replicate;
  const client = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });
  if (process.env.NODE_ENV !== "production") globalForReplicate.replicate = client;
  return client;
}

export async function generateImageFlux(
  prompt: string,
  options?: { aspectRatio?: string; raw?: boolean },
): Promise<{ buffer: Buffer; format: string }> {
  const replicate = getReplicate();

  const output = await replicate.run("black-forest-labs/flux-1.1-pro-ultra", {
    input: {
      prompt,
      aspect_ratio: options?.aspectRatio ?? "1:1",
      output_format: "png",
      safety_tolerance: 2,
      raw: options?.raw ?? false,
    },
  });

  // Replicate returns a ReadableStream or URL depending on the model
  let buffer: Buffer;
  if (output instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = output.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    buffer = Buffer.concat(chunks);
  } else if (typeof output === "string") {
    const response = await fetch(output);
    buffer = Buffer.from(await response.arrayBuffer());
  } else if (output && typeof output === "object" && "url" in (output as Record<string, unknown>)) {
    const response = await fetch((output as { url: string }).url);
    buffer = Buffer.from(await response.arrayBuffer());
  } else {
    throw new Error(`Unexpected Flux output type: ${typeof output}`);
  }

  return { buffer, format: "png" };
}
