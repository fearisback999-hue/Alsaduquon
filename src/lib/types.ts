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

export type ProductType = string;

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

export const SCORE_THRESHOLD = 5.5;

// Cost constants
export const DALLE_COST_HD = 0.08;
export const DALLE_COST_STANDARD = 0.04;
export const FLUX_PRO_ULTRA_COST = 0.06;
export const GPT41_INPUT_COST_PER_1K = 0.002;
export const GPT41_OUTPUT_COST_PER_1K = 0.008;
export const GPT4O_VISION_COST_ESTIMATE = 0.01;
export const CLAUDE_SONNET_INPUT_COST_PER_1K = 0.003;
export const CLAUDE_SONNET_OUTPUT_COST_PER_1K = 0.015;
export const ETSY_LISTING_FEE = 0.20;
export const ETSY_TRANSACTION_FEE_PERCENT = 6.5;
// Fees the pricing engine previously ignored — together ~18 points of margin.
export const ETSY_PAYMENT_PROCESSING_PERCENT = 3;   // ~3% of order total
export const ETSY_PAYMENT_PROCESSING_FLAT = 0.25;   // + $0.25 per order
export const ETSY_OFFSITE_ADS_PERCENT = 15;         // mandatory for shops < $10k/yr, charged on offsite-attributed sales
// Blended share of orders that are offsite-ad-attributed (not every order
// incurs the 15%). Tunable via ETSY_OFFSITE_ATTRIBUTION_RATE; 0.2 is a
// conservative default for a young shop.
export const ETSY_OFFSITE_ADS_ATTRIBUTION_RATE = 0.2;
export const SHOPIFY_LISTING_FEE = 0;
export const TIKTOK_LISTING_FEE = 0;
export const DEPOP_LISTING_FEE = 0;
export const REDBUBBLE_LISTING_FEE = 0;
export const AMAZON_LISTING_FEE = 0.99;
export const DEPOP_COMMISSION_PERCENT = 10;
export const TIKTOK_COMMISSION_PERCENT = 5;
