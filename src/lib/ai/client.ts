import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";
import { log } from "@/lib/logger";

const globalForOpenAI = globalThis as unknown as { openai: OpenAI | undefined };

export function getOpenAI(): OpenAI {
  if (globalForOpenAI.openai) return globalForOpenAI.openai;

  const client = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    timeout: 120_000,
    maxRetries: 2,
  });

  if (process.env.NODE_ENV !== "production") {
    globalForOpenAI.openai = client;
  }

  return client;
}

function isQuotaError(error: unknown): boolean {
  if (error instanceof OpenAI.APIError) {
    return error.status === 429 && /quota|billing|exceeded/i.test(error.message);
  }
  return false;
}

function hasClaudeFallback(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

export class StructuredOutputError extends Error {
  constructor(
    public schemaName: string,
    public rawContent: string,
    public zodIssues: z.ZodIssue[],
  ) {
    super(
      `Structured output for "${schemaName}" failed validation: ${zodIssues
        .map((i) => `${i.path.join(".")}: ${i.message}`)
        .join("; ")}`,
    );
    this.name = "StructuredOutputError";
  }
}

interface ChatCompletionOptions<T> {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  schema?: z.ZodType<T>;
  schemaName?: string;
}

interface ChatCompletionResult<T> {
  content: string;
  parsed: T | null;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export async function chatCompletion<T = unknown>(
  prompt: string,
  options?: ChatCompletionOptions<T>,
): Promise<ChatCompletionResult<T>> {
  try {
    return await openaiChatCompletion(prompt, options);
  } catch (error) {
    if (isQuotaError(error) && hasClaudeFallback()) {
      log("warn", `[AI] OpenAI quota exceeded — falling back to Claude for text completion`);
      const { claudeCompletion } = await import("@/lib/ai/providers");
      const result = await claudeCompletion(prompt, {
        systemPrompt: options?.systemPrompt,
        schema: options?.schema,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      });
      return {
        content: result.content,
        parsed: result.parsed,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
      };
    }
    throw error;
  }
}

async function openaiChatCompletion<T = unknown>(
  prompt: string,
  options?: ChatCompletionOptions<T>,
): Promise<ChatCompletionResult<T>> {
  const openai = getOpenAI();
  const model = options?.model ?? "gpt-4o";

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const schemaName = options?.schemaName ?? "response";
  const responseFormat = options?.schema
    ? zodResponseFormat(options.schema, schemaName)
    : options?.jsonMode
      ? { type: "json_object" as const }
      : undefined;

  const response = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: options?.maxTokens ?? 4000,
    temperature: options?.temperature ?? 0.7,
    ...(responseFormat && { response_format: responseFormat }),
  });

  const choice = response.choices[0];
  const content = choice.message.content ?? "";

  let parsed: T | null = null;
  if (options?.schema) {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new StructuredOutputError(schemaName, content, [
        { code: "custom", path: [], message: "Response was not valid JSON" } as z.ZodIssue,
      ]);
    }
    const result = options.schema.safeParse(raw);
    if (!result.success) {
      throw new StructuredOutputError(schemaName, content, result.error.issues);
    }
    parsed = result.data;
  }

  return {
    content,
    parsed,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    model,
  };
}

interface AnalyzeImageOptions<T> {
  systemPrompt?: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  jsonMode?: boolean;
  schema?: z.ZodType<T>;
  schemaName?: string;
}

export async function analyzeImage<T = unknown>(
  imageUrl: string,
  prompt: string,
  options?: AnalyzeImageOptions<T>,
): Promise<ChatCompletionResult<T>> {
  try {
    return await openaiAnalyzeImage(imageUrl, prompt, options);
  } catch (error) {
    if (isQuotaError(error) && hasClaudeFallback()) {
      log("warn", `[AI] OpenAI quota exceeded — falling back to Claude for image analysis`);
      const { claudeAnalyzeImage: claudeVision } = await import("@/lib/ai/providers");
      const result = await claudeVision(imageUrl, prompt, {
        systemPrompt: options?.systemPrompt,
        schema: options?.schema,
        maxTokens: options?.maxTokens,
        temperature: options?.temperature,
      });
      return {
        content: result.content,
        parsed: result.parsed,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        model: result.model,
      };
    }
    throw error;
  }
}

async function openaiAnalyzeImage<T = unknown>(
  imageUrl: string,
  prompt: string,
  options?: AnalyzeImageOptions<T>,
): Promise<ChatCompletionResult<T>> {
  const openai = getOpenAI();
  const model = options?.model ?? "gpt-4o";

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({
    role: "user",
    content: [
      { type: "text", text: prompt },
      { type: "image_url", image_url: { url: imageUrl, detail: "high" } },
    ],
  });

  const schemaName = options?.schemaName ?? "response";
  const responseFormat = options?.schema
    ? zodResponseFormat(options.schema, schemaName)
    : options?.jsonMode
      ? { type: "json_object" as const }
      : undefined;

  const response = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: options?.maxTokens ?? 500,
    temperature: options?.temperature ?? 0.3,
    ...(responseFormat && { response_format: responseFormat }),
  });

  const choice = response.choices[0];
  const content = choice.message.content ?? "";

  let parsed: T | null = null;
  if (options?.schema) {
    let raw: unknown;
    try {
      raw = JSON.parse(content);
    } catch {
      throw new StructuredOutputError(schemaName, content, [
        { code: "custom", path: [], message: "Response was not valid JSON" } as z.ZodIssue,
      ]);
    }
    const result = options.schema.safeParse(raw);
    if (!result.success) {
      throw new StructuredOutputError(schemaName, content, result.error.issues);
    }
    parsed = result.data;
  }

  return {
    content,
    parsed,
    inputTokens: response.usage?.prompt_tokens ?? 0,
    outputTokens: response.usage?.completion_tokens ?? 0,
    model,
  };
}

export async function generateImage(
  prompt: string,
  options?: { model?: string; size?: "1024x1024" | "1792x1024" | "1024x1792"; quality?: "hd" | "standard" },
): Promise<{ url: string; revisedPrompt?: string }> {
  const openai = getOpenAI();

  const response = await openai.images.generate({
    model: options?.model ?? "dall-e-3",
    prompt,
    n: 1,
    size: options?.size ?? "1024x1024",
    quality: options?.quality ?? "hd",
    response_format: "url",
  });

  const image = response.data?.[0];
  if (!image?.url) {
    throw new Error("Image generation returned no URL");
  }
  return {
    url: image.url,
    revisedPrompt: image.revised_prompt ?? undefined,
  };
}
