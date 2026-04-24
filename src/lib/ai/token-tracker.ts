import { db } from "@/lib/db";
import { tokenUsages } from "@/lib/db/schema";
import { recordCost } from "@/lib/cost/guard";
import { estimateTextCost, estimateImageCost } from "@/lib/cost/estimator";

export async function trackTextUsage(params: {
  model: string;
  operation: string;
  inputTokens: number;
  outputTokens: number;
  durationMs?: number;
  pipelineRunId?: string;
}): Promise<number> {
  // Guard against bogus inputs that could deflate the daily cost total.
  const inputTokens = Math.max(0, params.inputTokens);
  const outputTokens = Math.max(0, params.outputTokens);
  const cost = Math.max(0, estimateTextCost(inputTokens, outputTokens));

  await db.insert(tokenUsages).values({
    modelName: params.model,
    operation: params.operation,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost: cost,
    durationMs: params.durationMs,
    pipelineRunId: params.pipelineRunId,
  });

  await recordCost("openai_text", cost, {
    modelName: params.model,
    description: `${params.operation}: ${inputTokens}in/${outputTokens}out tokens`,
  });

  return cost;
}

export async function trackImageUsage(params: {
  model: string;
  operation: string;
  quality: "hd" | "standard";
  durationMs?: number;
  pipelineRunId?: string;
  referenceId?: string;
}): Promise<number> {
  const cost = Math.max(0, estimateImageCost(params.quality));

  await db.insert(tokenUsages).values({
    modelName: params.model,
    operation: params.operation,
    inputTokens: 0,
    outputTokens: 0,
    totalTokens: 0,
    estimatedCost: cost,
    durationMs: params.durationMs,
    pipelineRunId: params.pipelineRunId,
  });

  await recordCost("openai_image", cost, {
    modelName: params.model,
    description: `Image generation (${params.quality})`,
    referenceId: params.referenceId,
    referenceType: "generated_image",
  });

  return cost;
}
