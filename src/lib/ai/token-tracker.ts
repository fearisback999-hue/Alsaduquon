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
}): Promise<void> {
  const cost = estimateTextCost(params.inputTokens, params.outputTokens);

  await db.insert(tokenUsages).values({
    modelName: params.model,
    operation: params.operation,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    totalTokens: params.inputTokens + params.outputTokens,
    estimatedCost: cost,
    durationMs: params.durationMs,
    pipelineRunId: params.pipelineRunId,
  });

  await recordCost("openai_text", cost, {
    modelName: params.model,
    description: `${params.operation}: ${params.inputTokens}in/${params.outputTokens}out tokens`,
  });
}

export async function trackImageUsage(params: {
  model: string;
  operation: string;
  quality: "hd" | "standard";
  durationMs?: number;
  pipelineRunId?: string;
  referenceId?: string;
}): Promise<void> {
  const cost = estimateImageCost(params.quality);

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
}
