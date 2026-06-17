import { describe, it, expect } from "vitest";
import { recommendedLimitForAgeDays } from "./listing-limit-advisor";

describe("recommendedLimitForAgeDays", () => {
  it("keeps a brand-new shop at the conservative new-shop ceiling", () => {
    expect(recommendedLimitForAgeDays(0)).toBe(5);
    expect(recommendedLimitForAgeDays(29)).toBe(5);
  });

  it("ramps up monotonically as the shop ages", () => {
    const ages = [0, 30, 60, 90, 150, 210, 300, 365, 1000];
    const limits = ages.map(recommendedLimitForAgeDays);
    for (let i = 1; i < limits.length; i++) {
      expect(limits[i]).toBeGreaterThanOrEqual(limits[i - 1]);
    }
  });

  it("never recommends an unsafe jump for a young shop", () => {
    // A 2-month-old shop should still be well under dozens/day.
    expect(recommendedLimitForAgeDays(60)).toBeLessThanOrEqual(12);
  });

  it("caps at the mature-shop ceiling", () => {
    expect(recommendedLimitForAgeDays(5000)).toBe(60);
  });
});
