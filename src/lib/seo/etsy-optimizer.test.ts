import { describe, it, expect } from "vitest";
import { scoreTitle, optimizeEtsyListing } from "./etsy-optimizer";

describe("scoreTitle", () => {
  it("rewards a well-structured, full-length, front-loaded title", () => {
    const title = "Cottagecore Mushroom Shirt | Cute Gift for Plant Lovers, Vintage Botanical Tee";
    const { score } = scoreTitle(title, "cottagecore mushroom", 140);
    expect(score).toBeGreaterThan(70);
  });

  it("penalizes a too-short single-phrase title with no intent token", () => {
    const { score } = scoreTitle("Mushroom Art", "cottagecore mushroom", 140);
    const full = scoreTitle(
      "Cottagecore Mushroom Shirt | Cute Gift for Plant Lovers, Vintage Botanical Tee",
      "cottagecore mushroom",
      140,
    ).score;
    expect(score).toBeLessThan(full);
  });

  it("flags a missing head keyword", () => {
    const { reasons } = scoreTitle("Random Floral Design Tee for Everyone", "cottagecore mushroom", 140);
    expect(reasons.some((r) => r.includes("head keyword missing"))).toBe(true);
  });

  it("detects keyword stuffing", () => {
    const { reasons } = scoreTitle("mushroom mushroom mushroom mushroom shirt", "mushroom", 140);
    expect(reasons.some((r) => r.includes("stuffed") || r.includes("repetition"))).toBe(true);
  });
});

describe("optimizeEtsyListing", () => {
  const baseInput = {
    niche: "cottagecore mushroom",
    conceptTitle: "Mystic Forest Mushrooms",
    productType: "Unisex T-Shirt",
    titleVariants: [
      "Mushroom Tee",
      "Cottagecore Mushroom Shirt | Cute Gift for Plant Lovers, Vintage Botanical Tee",
    ],
    tags: ["mushroom shirt", "cottagecore"],
    buyerPersona: "plant lovers",
    occasion: "birthday",
    maxTitleLength: 140,
    maxTags: 13,
    maxTagLength: 20,
  };

  it("picks the highest-scoring title variant", () => {
    const result = optimizeEtsyListing(baseInput);
    expect(result.title).toBe(
      "Cottagecore Mushroom Shirt | Cute Gift for Plant Lovers, Vintage Botanical Tee",
    );
  });

  it("fills all 13 tag slots when the niche is short enough for long-tail", () => {
    const result = optimizeEtsyListing({
      ...baseInput,
      niche: "mushroom",
      titleVariants: ["Mushroom Shirt | Cute Gift for Plant Lovers, Vintage Botanical Tee"],
    });
    expect(result.tags.length).toBe(13);
  });

  it("produces no duplicate tags", () => {
    const result = optimizeEtsyListing(baseInput);
    const unique = new Set(result.tags.map((t) => t.toLowerCase()));
    expect(unique.size).toBe(result.tags.length);
  });

  it("respects the max tag length", () => {
    const result = optimizeEtsyListing(baseInput);
    for (const tag of result.tags) {
      expect(tag.length).toBeLessThanOrEqual(20);
    }
  });

  it("synthesizes a product-appropriate noun tag (mug, not shirt)", () => {
    // Feed mug-appropriate title variants — the synthesized backfill must use
    // the mug product noun, never 'shirt'.
    const result = optimizeEtsyListing({
      ...baseInput,
      productType: "Ceramic Mug",
      titleVariants: ["Cottagecore Mushroom Mug | Cute Gift for Plant Lovers, Coffee Cup"],
      tags: ["mushroom mug", "cottagecore"],
    });
    expect(result.tags.some((t) => t.includes("mug"))).toBe(true);
    expect(result.tags.some((t) => t.includes("shirt") || t.includes(" tee"))).toBe(false);
  });

  it("falls back to a derived title when no variants are usable", () => {
    const result = optimizeEtsyListing({ ...baseInput, titleVariants: ["", "   "] });
    expect(result.title.length).toBeGreaterThan(0);
  });
});
