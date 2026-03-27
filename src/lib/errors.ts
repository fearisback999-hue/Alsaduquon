export class BudgetExceededError extends Error {
  constructor(
    public readonly dailyCost: number,
    public readonly maxCost: number,
  ) {
    super(`Daily budget exceeded: $${dailyCost.toFixed(2)} / $${maxCost.toFixed(2)}`);
    this.name = "BudgetExceededError";
  }
}

export class ListingLimitError extends Error {
  constructor(
    public readonly count: number,
    public readonly max: number,
  ) {
    super(`Daily listing limit reached: ${count} / ${max}`);
    this.name = "ListingLimitError";
  }
}

export class PipelineStepError extends Error {
  constructor(
    message: string,
    public readonly step: number,
    public readonly stepName: string,
    public readonly cause?: unknown,
  ) {
    super(`Pipeline step ${step} (${stepName}) failed: ${message}`);
    this.name = "PipelineStepError";
  }
}

export class ExternalAPIError extends Error {
  constructor(
    public readonly service: string,
    public readonly statusCode: number | undefined,
    message: string,
  ) {
    super(`${service} API error (${statusCode ?? "unknown"}): ${message}`);
    this.name = "ExternalAPIError";
  }

  get isRetryable(): boolean {
    if (!this.statusCode) return true; // Network error
    return this.statusCode >= 500 || this.statusCode === 429;
  }
}

export class ValidationError extends Error {
  constructor(
    message: string,
    public readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}
