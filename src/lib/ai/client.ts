import OpenAI from "openai";
import { zodResponseFormat } from "openai/helpers/zod";
import type { z } from "zod";

const globalForOpenAI = globalThis as unknown as { openai: OpenAI | undefined };

export function getOpenAI(): OpenAI {
  if (globalForOpenAI.openai) return globalForOpenAI.openai;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (process.env.NODE_ENV !== "production") {
    globalForOpenAI.openai = client;
  }

  return client;
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
  const openai = getOpenAI();
  const model = options?.model ?? "gpt-4.1";

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

  return {
    url: response.data![0].url!,
    revisedPrompt: response.data![0].revised_prompt ?? undefined,
  };
}
