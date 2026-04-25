import {
  DALLE_COST_HD,
  DALLE_COST_STANDARD,
  FLUX_PRO_ULTRA_COST,
  GPT41_INPUT_COST_PER_1K,
  GPT41_OUTPUT_COST_PER_1K,
  GPT4O_VISION_COST_ESTIMATE,
  CLAUDE_SONNET_INPUT_COST_PER_1K,
  CLAUDE_SONNET_OUTPUT_COST_PER_1K,
} from "@/lib/types";

export function estimateTextCost(inputTokens: number, outputTokens: number, provider: string = "openai"): number {
  if (provider === "anthropic") {
    return (inputTokens / 1000) * CLAUDE_SONNET_INPUT_COST_PER_1K + (outputTokens / 1000) * CLAUDE_SONNET_OUTPUT_COST_PER_1K;
  }
  return (inputTokens / 1000) * GPT41_INPUT_COST_PER_1K + (outputTokens / 1000) * GPT41_OUTPUT_COST_PER_1K;
}

export function estimateImageCost(quality: "hd" | "standard" | "flux" = "hd"): number {
  if (quality === "flux") return FLUX_PRO_ULTRA_COST;
  return quality === "hd" ? DALLE_COST_HD : DALLE_COST_STANDARD;
}

export function estimateVisionCost(): number {
  return GPT4O_VISION_COST_ESTIMATE;
}

export function estimateModerationCost(): number {
  return 0;
}

export function estimateFullPipelineCost(nicheCount: number, conceptsPerNiche: number): number {
  const textCalls = nicheCount * 4;
  const imageCalls = nicheCount * conceptsPerNiche;
  const visionCalls = imageCalls;
  const textCost = textCalls * estimateTextCost(2000, 1000);
  const imageCost = imageCalls * estimateImageCost("flux");
  const visionCost = visionCalls * estimateVisionCost();
  return textCost + imageCost + visionCost;
}
