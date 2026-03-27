import {
  DALLE_COST_HD,
  DALLE_COST_STANDARD,
  GPT41_INPUT_COST_PER_1K,
  GPT41_OUTPUT_COST_PER_1K,
} from "@/lib/types";

export function estimateTextCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1000) * GPT41_INPUT_COST_PER_1K + (outputTokens / 1000) * GPT41_OUTPUT_COST_PER_1K;
}

export function estimateImageCost(quality: "hd" | "standard" = "hd"): number {
  return quality === "hd" ? DALLE_COST_HD : DALLE_COST_STANDARD;
}

export function estimateModerationCost(): number {
  return 0; // OpenAI moderation is free
}

export function estimateFullPipelineCost(nicheCount: number, conceptsPerNiche: number): number {
  // Rough estimate for budget checks before running
  const textCalls = nicheCount * 3; // scoring + concepts + listing per niche
  const imageCalls = nicheCount * conceptsPerNiche;
  const textCost = textCalls * estimateTextCost(2000, 1000);
  const imageCost = imageCalls * estimateImageCost("hd");
  return textCost + imageCost;
}
