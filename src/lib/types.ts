export const STEP_NAMES = [
  "research",
  "scoring",
  "concepts",
  "imagegen",
  "validation",
  "printify",
  "mockups",
  "listing",
  "approval",
  "publish",
] as const;

export type StepName = (typeof STEP_NAMES)[number];

export type PipelineStatus = "pending" | "running" | "completed" | "failed" | "paused";

export type NicheStatus = "discovered" | "scored" | "approved" | "rejected" | "active" | "exhausted";

export type ProductType = "premium_tshirt" | "hoodie" | "blanket";

export type ApprovalMode = "manual" | "auto";

export type DesignType = "typography" | "illustration" | "hybrid" | "pattern";

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
  startFromStep: number;
  dryRun: boolean;
}

// Scoring weights matching the XML spec
export const SCORING_WEIGHTS = {
  searchVolume: 0.30,
  competition: 0.25,
  salesVelocity: 0.25,
  seasonality: 0.10,
  trending: 0.10,
} as const;

export const SCORE_THRESHOLD = 7.5;

// Printify product blueprints (will be overridden from settings)
export const DEFAULT_PRODUCT_CONFIGS: Record<ProductType, { blueprintId: number; printProviderId: number; printAreaWidth: number; printAreaHeight: number }> = {
  premium_tshirt: { blueprintId: 145, printProviderId: 99, printAreaWidth: 4500, printAreaHeight: 5400 },
  hoodie: { blueprintId: 77, printProviderId: 99, printAreaWidth: 4500, printAreaHeight: 5400 },
  blanket: { blueprintId: 462, printProviderId: 99, printAreaWidth: 4500, printAreaHeight: 5400 },
};

export const DEFAULT_COLORS = ["black", "navy", "white", "grey"] as const;

// Cost constants
export const DALLE_COST_HD = 0.08;
export const DALLE_COST_STANDARD = 0.04;
export const GPT41_INPUT_COST_PER_1K = 0.002;
export const GPT41_OUTPUT_COST_PER_1K = 0.008;
export const ETSY_LISTING_FEE = 0.20;
export const ETSY_TRANSACTION_FEE_PERCENT = 6.5;
