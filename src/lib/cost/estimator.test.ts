import { describe, it, expect } from "vitest";
import {
  estimateTextCost,
  estimateImageCost,
  estimateFullPipelineCost,
} from "./estimator";

describe("estimateTextCost", () => {
  it("returns 0 for no tokens", () => {
    expect(estimateTextCost(0, 0)).toBe(0);
  });

  it("scales with token count", () => {
    const small = estimateTextCost(1000, 500);
    const large = estimateTextCost(10000, 5000);
    expect(large).toBeGreaterThan(small);
    expect(large).toBeCloseTo(small * 10, 5);
  });

  it("prices anthropic and openai differently", () => {
    const openai = estimateTextCost(1000, 1000, "openai");
    const anthropic = estimateTextCost(1000, 1000, "anthropic");
    expect(openai).not.toBe(anthropic);
  });
});

describe("estimateImageCost", () => {
  it("returns distinct costs per quality tier", () => {
    const hd = estimateImageCost("hd");
    const standard = estimateImageCost("standard");
    const flux = estimateImageCost("flux");
    expect(hd).toBeGreaterThan(0);
    expect(standard).toBeGreaterThan(0);
    expect(flux).toBeGreaterThan(0);
    expect(hd).not.toBe(standard);
  });
});

describe("estimateFullPipelineCost", () => {
  it("scales with niche and concept counts", () => {
    const small = estimateFullPipelineCost(1, 2);
    const large = estimateFullPipelineCost(5, 4);
    expect(large).toBeGreaterThan(small);
  });

  it("returns a finite positive cost", () => {
    const cost = estimateFullPipelineCost(3, 3);
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThan(0);
  });
});
