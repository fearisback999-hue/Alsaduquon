import type { Database } from "@/lib/db";
import type { StepName } from "@/lib/types";

export interface StepResult {
  status: "completed" | "failed" | "skipped";
  message?: string;
  cost?: number;
  data?: Record<string, unknown>;
}

export interface PipelineStep {
  name: StepName;
  number: number;
  execute: (context: PipelineContext) => Promise<StepResult>;
}

export interface PipelineContext {
  pipelineRunId: string;
  db: Database;
  dryRun: boolean;

  // Accumulated data from previous steps — avoids re-querying
  discoveredNicheIds: string[];
  approvedNicheIds: string[];
  generatedImageIds: string[];
  validatedImageIds: string[];
  createdProductIds: string[];
  draftListingIds: string[];
  approvedListingIds: string[];
}

export function createEmptyContext(pipelineRunId: string, db: Database, dryRun: boolean = false): PipelineContext {
  return {
    pipelineRunId,
    db,
    dryRun,
    discoveredNicheIds: [],
    approvedNicheIds: [],
    generatedImageIds: [],
    validatedImageIds: [],
    createdProductIds: [],
    draftListingIds: [],
    approvedListingIds: [],
  };
}
