import { describe, it, expect } from "vitest";
import {
  calculateDynamicPrice,
  calculateTeasePrice,
  selectHookVariantIndex,
  getTargetMargin,
  getTypicalCost,
  getTypicalShipping,
  getLandedCost,
  estimateEtsyFees,
} from "./engine";
import { estimateProfit } from "../etsy/pricing";

describe("calculateDynamicPrice", () => {
  it("prices a t-shirt within its market range", () => {
    const result = calculateDynamicPrice({
      productType: "unisex_tshirt",
      baseCost: 12,
      marginPercent: 40,
    });
    expect(result.retailPrice).toBeGreaterThanOrEqual(22);
    expect(result.retailPrice).toBeLessThanOrEqual(32);
  });

  it("always nets a positive margin after the full Etsy fee stack", () => {
    const result = calculateDynamicPrice({
      productType: "unisex_tshirt",
      baseCost: 12,
      marginPercent: 40,
    });
    const fees = estimateEtsyFees(result.retailPrice);
    const profit = result.retailPrice - 12 - fees;
    expect(profit).toBeGreaterThan(0);
  });

  it("uses .99 psychological pricing", () => {
    const result = calculateDynamicPrice({
      productType: "hoodie",
      baseCost: 22,
      marginPercent: 50,
    });
    expect(result.retailPrice % 1).toBeCloseTo(0.99, 2);
  });

  it("charges a premium for high-demand niches", () => {
    const base = calculateDynamicPrice({ productType: "poster", baseCost: 8, marginPercent: 40 });
    const premium = calculateDynamicPrice({
      productType: "poster",
      baseCost: 8,
      marginPercent: 40,
      nicheCompositeScore: 9.5,
    });
    expect(premium.demandMultiplier).toBeGreaterThan(base.demandMultiplier);
  });

  it("never produces NaN even for an unachievable margin", () => {
    const result = calculateDynamicPrice({
      productType: "unisex_tshirt",
      baseCost: 12,
      marginPercent: 95, // unachievable against the fee stack
    });
    expect(Number.isFinite(result.retailPrice)).toBe(true);
  });

  it("handles unknown product types with a default range", () => {
    const result = calculateDynamicPrice({
      productType: "nonexistent_product",
      baseCost: 10,
      marginPercent: 40,
    });
    expect(Number.isFinite(result.retailPrice)).toBe(true);
    expect(result.productTypeRange).toEqual({ min: 15, max: 50 });
  });
});

describe("calculateTeasePrice", () => {
  it("discounts off the full price toward the requested percent", () => {
    const result = calculateTeasePrice(29.99, 12, 70, { floorMode: "cost" });
    expect(result.hookPrice).toBeLessThan(29.99);
    expect(result.fullPrice).toBe(29.99);
  });

  it("cost floor mode never sells below fee-inclusive break-even", () => {
    const result = calculateTeasePrice(29.99, 12, 90, { floorMode: "cost" });
    // At break-even, hook must at least cover COGS.
    expect(result.hookPrice).toBeGreaterThanOrEqual(12 - 1); // .99 rounding tolerance
  });

  it("absolute floor mode respects the configured floor", () => {
    const result = calculateTeasePrice(29.99, 5, 95, { floorMode: "absolute", absoluteFloor: 5.99 });
    expect(result.hookPrice).toBeGreaterThanOrEqual(5.99 - 1);
  });

  it("clamps discount to a sane maximum", () => {
    const result = calculateTeasePrice(29.99, 12, 200, { floorMode: "cost" });
    expect(result.hookPrice).toBeGreaterThan(0);
    expect(Number.isFinite(result.hookPrice)).toBe(true);
  });

  it("uses .99 pricing for the hook", () => {
    const result = calculateTeasePrice(35.99, 14, 60, { floorMode: "cost" });
    expect(result.hookPrice % 1).toBeCloseTo(0.99, 2);
  });
});

describe("selectHookVariantIndex", () => {
  it("returns null for a single-variant product", () => {
    expect(selectHookVariantIndex([{ id: 1, title: "One Size" }])).toBeNull();
  });

  it("prefers an unpopular plausible variant over a bestseller", () => {
    const variants = [
      { id: 1, title: "Black / M" },     // bestseller — never pick
      { id: 2, title: "White / L" },     // bestseller — never pick
      { id: 3, title: "Sand / Youth S" }, // perfect hook
    ];
    const idx = selectHookVariantIndex(variants);
    expect(idx).toBe(2);
  });

  it("avoids the giant suspicious sizes when a better hook exists", () => {
    const variants = [
      { id: 1, title: "Black / M" },
      { id: 2, title: "Lime / 6XL" },   // looks like bait
      { id: 3, title: "Cream / XS" },   // legit but low-demand
    ];
    const idx = selectHookVariantIndex(variants);
    expect(idx).toBe(2);
  });
});

describe("getTargetMargin", () => {
  it("gives premium products a higher margin", () => {
    expect(getTargetMargin("canvas_print")).toBeGreaterThan(getTargetMargin("unisex_tshirt"));
  });

  it("gives commodity products a lower margin", () => {
    expect(getTargetMargin("sticker")).toBeLessThan(getTargetMargin("unisex_tshirt"));
  });

  it("clamps margin to the 30-55 range", () => {
    expect(getTargetMargin("canvas_print", 0.1)).toBeLessThanOrEqual(55);
    expect(getTargetMargin("sticker", 0.9)).toBeGreaterThanOrEqual(30);
  });

  it("raises margin in low-competition niches and lowers it in high-competition", () => {
    const low = getTargetMargin("unisex_tshirt", 0.1);
    const high = getTargetMargin("unisex_tshirt", 0.9);
    expect(low).toBeGreaterThan(high);
  });
});

describe("getTypicalCost", () => {
  it("returns known product costs", () => {
    expect(getTypicalCost("unisex_tshirt")).toBe(12);
    expect(getTypicalCost("hoodie")).toBe(22);
  });

  it("falls back for unknown products", () => {
    expect(getTypicalCost("unknown")).toBe(15);
  });
});

describe("shipping folded into the cost basis", () => {
  it("getTypicalShipping returns a positive cost for known and unknown products", () => {
    expect(getTypicalShipping("unisex_tshirt")).toBeGreaterThan(0);
    expect(getTypicalShipping("unknown_product")).toBeGreaterThan(0);
  });

  it("getLandedCost adds shipping only when included", () => {
    expect(getLandedCost("unisex_tshirt", 12, false)).toBe(12);
    expect(getLandedCost("unisex_tshirt", 12, true)).toBe(12 + getTypicalShipping("unisex_tshirt"));
  });

  it("THE KEY FIX: nets a positive margin after BOTH fees and shipping", () => {
    const ship = getTypicalShipping("mug_11oz");
    const result = calculateDynamicPrice({
      productType: "mug_11oz",
      baseCost: 7,
      shippingCost: ship,
      marginPercent: 40,
    });
    const fees = estimateEtsyFees(result.retailPrice);
    const realProfit = result.retailPrice - 7 - ship - fees;
    expect(realProfit).toBeGreaterThan(0);
  });

  it("prices at least as high when shipping is folded in", () => {
    const without = calculateDynamicPrice({ productType: "mug_11oz", baseCost: 7, marginPercent: 40 });
    const withShip = calculateDynamicPrice({
      productType: "mug_11oz",
      baseCost: 7,
      shippingCost: getTypicalShipping("mug_11oz"),
      marginPercent: 40,
    });
    expect(withShip.retailPrice).toBeGreaterThanOrEqual(without.retailPrice);
  });

  it("reports landedCost and shippingCost in the result", () => {
    const result = calculateDynamicPrice({
      productType: "unisex_tshirt",
      baseCost: 12,
      shippingCost: 4.75,
      marginPercent: 40,
    });
    expect(result.shippingCost).toBe(4.75);
    expect(result.landedCost).toBeCloseTo(16.75, 2);
  });

  it("computes the reported margin against landed cost", () => {
    const r = calculateDynamicPrice({
      productType: "unisex_tshirt",
      baseCost: 12,
      shippingCost: 4.75,
      marginPercent: 40,
    });
    const fees = estimateEtsyFees(r.retailPrice);
    const expected = ((r.retailPrice - 16.75 - fees) / r.retailPrice) * 100;
    expect(r.marginPercent).toBeCloseTo(expected, 1);
  });
});

describe("estimateProfit accounts for shipping", () => {
  it("subtracts merchant shipping from profit and adds it to total cost", () => {
    const noShip = estimateProfit(30, 12, 1, 0);
    const withShip = estimateProfit(30, 12, 1, 5);
    expect(withShip.profit).toBeCloseTo(noShip.profit - 5, 2);
    expect(withShip.cost).toBeCloseTo(noShip.cost + 5, 2);
  });

  it("scales shipping by quantity", () => {
    const r = estimateProfit(60, 12, 2, 5);
    expect(r.shippingCost).toBe(10);
  });
});
