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
  provider?: string;
  costPreRecorded?: boolean;
}): Promise<number> {
  const inputTokens = Math.max(0, params.inputTokens);
  const outputTokens = Math.max(0, params.outputTokens);
  const provider = params.provider ?? (params.model.startsWith("claude") ? "anthropic" : "openai");
  const cost = Math.max(0, estimateTextCost(inputTokens, outputTokens, provider));

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

  if (!params.costPreRecorded) {
    const costCategory = provider === "anthropic" ? "anthropic_text" : "openai_text";
    await recordCost(costCategory, cost, {
      modelName: params.model,
      description: `${params.operation}: ${inputTokens}in/${outputTokens}out tokens`,
    });
  }

  return cost;
}

export async function trackImageUsage(params: {
  model: string;
  operation: string;
  quality: "hd" | "standard" | "flux";
  durationMs?: number;
  pipelineRunId?: string;
  referenceId?: string;
  costPreRecorded?: boolean;
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

  if (!params.costPreRecorded) {
    const costCategory = params.quality === "flux" ? "replicate_image" : "openai_image";
    await recordCost(costCategory, cost, {
      modelName: params.model,
      description: `Image generation (${params.quality})`,
      referenceId: params.referenceId,
      referenceType: "generated_image",
    });
  }

  return cost;
}
