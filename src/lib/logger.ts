import { db } from "./db";
import { pipelineStepLogs } from "./db/schema";

const SECRET_PATTERNS = [
  /sk-[a-zA-Z0-9]{20,}/g,
  /eyJ[a-zA-Z0-9_-]{10,}/g,
  /Bearer\s+[a-zA-Z0-9._-]+/g,
  /token[=:]\s*["']?[a-zA-Z0-9._-]{10,}/gi,
];

function redactSecrets(message: string): string {
  let redacted = message;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, "[REDACTED]");
  }
  return redacted;
}

export function log(level: "info" | "warn" | "error", message: string, data?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    level,
    message: redactSecrets(message),
    ...(data && { data: JSON.parse(redactSecrets(JSON.stringify(data))) }),
  };
  if (level === "error") {
    console.error(JSON.stringify(entry));
  } else {
    console.log(JSON.stringify(entry));
  }
}

export function createStepLogger(pipelineRunId: string, stepNumber: number, stepName: string) {
  const startTime = Date.now();

  return {
    info(message: string, data?: Record<string, unknown>) {
      log("info", `[Step ${stepNumber}: ${stepName}] ${message}`, data);
    },
    warn(message: string, data?: Record<string, unknown>) {
      log("warn", `[Step ${stepNumber}: ${stepName}] ${message}`, data);
    },
    error(message: string, data?: Record<string, unknown>) {
      log("error", `[Step ${stepNumber}: ${stepName}] ${message}`, data);
    },
    async recordStart() {
      await db.insert(pipelineStepLogs).values({
        pipelineRunId,
        stepNumber,
        stepName,
        status: "started",
      });
    },
    async recordComplete(outputSummary?: string, cost?: number) {
      await db.insert(pipelineStepLogs).values({
        pipelineRunId,
        stepNumber,
        stepName,
        status: "completed",
        durationMs: Date.now() - startTime,
        outputSummary,
        cost,
      });
    },
    async recordFailed(error: string) {
      await db.insert(pipelineStepLogs).values({
        pipelineRunId,
        stepNumber,
        stepName,
        status: "failed",
        error: redactSecrets(error),
        durationMs: Date.now() - startTime,
      });
    },
    async recordSkipped(reason?: string) {
      await db.insert(pipelineStepLogs).values({
        pipelineRunId,
        stepNumber,
        stepName,
        status: "skipped",
        outputSummary: reason,
        durationMs: Date.now() - startTime,
      });
    },
  };
}
