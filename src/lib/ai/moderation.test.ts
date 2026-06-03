import { describe, it, expect } from "vitest";
import { checkEtsyPolicy, screenNicheForIP } from "./moderation";

describe("checkEtsyPolicy", () => {
  it("passes clean original listings", () => {
    const result = checkEtsyPolicy("Vintage Mountain Sunset Hiking T-Shirt for Nature Lovers");
    expect(result.passed).toBe(true);
    expect(result.violations).toHaveLength(0);
  });

  it("flags trademarked brand names", () => {
    const result = checkEtsyPolicy("Disney Mickey Mouse Birthday Shirt");
    expect(result.passed).toBe(false);
    expect(result.violations.some((v) => v.includes("disney"))).toBe(true);
  });

  it("flags copyrighted characters", () => {
    const result = checkEtsyPolicy("Baby Yoda Grogu Hoodie");
    expect(result.passed).toBe(false);
  });

  it("flags athletic brands and logos", () => {
    expect(checkEtsyPolicy("Nike swoosh inspired tee").passed).toBe(false);
    expect(checkEtsyPolicy("Adidas three stripes design").passed).toBe(false);
  });

  it("does NOT flag legal niche aesthetic words", () => {
    // These must pass — flagging them would gut the catalog.
    expect(checkEtsyPolicy("Boho Aesthetic Wall Art Poster").passed).toBe(true);
    expect(checkEtsyPolicy("Nature Inspired Minimalist Print").passed).toBe(true);
    expect(checkEtsyPolicy("Vintage Style Retro Sunset").passed).toBe(true);
  });

  it("flags high-precision IP-risk patterns", () => {
    expect(checkEtsyPolicy("Cool fan art of a dragon").passed).toBe(false);
    expect(checkEtsyPolicy("Portrait in the style of Van Gogh").passed).toBe(false);
    expect(checkEtsyPolicy("Official Pokemon merchandise").passed).toBe(false);
  });

  it("matches whole words only, not substrings", () => {
    // "applesauce" contains "apple" but should not trip the "apple" brand term.
    const result = checkEtsyPolicy("Homemade applesauce recipe card");
    expect(result.passed).toBe(true);
  });

  it("is case-insensitive", () => {
    expect(checkEtsyPolicy("DISNEY castle").passed).toBe(false);
    expect(checkEtsyPolicy("disney castle").passed).toBe(false);
    expect(checkEtsyPolicy("DiSnEy castle").passed).toBe(false);
  });
});

describe("screenNicheForIP", () => {
  it("returns null for clean niche keywords", () => {
    expect(screenNicheForIP("cottagecore gardening")).toBeNull();
    expect(screenNicheForIP("dad jokes")).toBeNull();
  });

  it("returns a violation reason for infringing keywords", () => {
    const reason = screenNicheForIP("harry potter fans");
    expect(reason).toBeTruthy();
    expect(typeof reason).toBe("string");
  });
});
