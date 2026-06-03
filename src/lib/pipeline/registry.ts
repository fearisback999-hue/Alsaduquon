import type { PipelineStep } from "./context";
import { STEP_NAMES } from "@/lib/types";

// Steps are lazily imported to keep bundle size down
const stepModules: Record<number, () => Promise<{ default: PipelineStep["execute"] }>> = {
  1: () => import("./steps/step-01-research"),
  2: () => import("./steps/step-02-scoring"),
  3: () => import("./steps/step-03-concepts"),
  4: () => import("./steps/step-04-imagegen"),
  5: () => import("./steps/step-05-validate"),
  6: () => import("./steps/step-06-printify"),
  7: () => import("./steps/step-07-mockups"),
  8: () => import("./steps/step-08-listing"),
  9: () => import("./steps/step-09-approval"),
  10: () => import("./steps/step-10-publish"),
};

export async function getStep(stepNumber: number): Promise<PipelineStep> {
  const loader = stepModules[stepNumber];
  if (!loader) {
    throw new Error(`Unknown pipeline step: ${stepNumber}`);
  }

  const stepModule = await loader();
  return {
    name: STEP_NAMES[stepNumber - 1],
    number: stepNumber,
    execute: stepModule.default,
  };
}

export const TOTAL_STEPS = 10;
