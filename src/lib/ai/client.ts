import OpenAI from "openai";

const globalForOpenAI = globalThis as unknown as { openai: OpenAI | undefined };

export function getOpenAI(): OpenAI {
  if (globalForOpenAI.openai) return globalForOpenAI.openai;

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

  if (process.env.NODE_ENV !== "production") {
    globalForOpenAI.openai = client;
  }

  return client;
}

export async function chatCompletion(
  prompt: string,
  options?: {
    systemPrompt?: string;
    model?: string;
    maxTokens?: number;
    temperature?: number;
    jsonMode?: boolean;
  },
): Promise<{ content: string; inputTokens: number; outputTokens: number; model: string }> {
  const openai = getOpenAI();
  const model = options?.model ?? "gpt-4.1";

  const messages: OpenAI.ChatCompletionMessageParam[] = [];
  if (options?.systemPrompt) {
    messages.push({ role: "system", content: options.systemPrompt });
  }
  messages.push({ role: "user", content: prompt });

  const response = await openai.chat.completions.create({
    model,
    messages,
    max_tokens: options?.maxTokens ?? 4000,
    temperature: options?.temperature ?? 0.7,
    ...(options?.jsonMode && { response_format: { type: "json_object" } }),
  });

  const choice = response.choices[0];
  return {
    content: choice.message.content ?? "",
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
