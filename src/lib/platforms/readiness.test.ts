import { describe, it, expect, afterEach } from "vitest";
import { getPlatformReadiness, getPlatformReadinessSummary } from "./readiness";

const ETSY_VARS = ["ETSY_CLIENT_ID", "ETSY_CLIENT_SECRET", "ETSY_REFRESH_TOKEN", "ETSY_SHOP_ID"];

describe("platform readiness", () => {
  const saved: Record<string, string | undefined> = {};

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  it("reports a platform unconfigured when env vars are missing", () => {
    for (const v of ETSY_VARS) { saved[v] = process.env[v]; delete process.env[v]; }
    const etsy = getPlatformReadiness().find((p) => p.id === "etsy")!;
    expect(etsy.configured).toBe(false);
    expect(etsy.missingEnv).toEqual(expect.arrayContaining(ETSY_VARS));
    expect(etsy.capabilities.publish).toBe(false);
  });

  it("reports a platform configured once all env vars are set", () => {
    for (const v of ETSY_VARS) { saved[v] = process.env[v]; process.env[v] = "x"; }
    const etsy = getPlatformReadiness().find((p) => p.id === "etsy")!;
    expect(etsy.configured).toBe(true);
    expect(etsy.missingEnv).toEqual([]);
    expect(etsy.capabilities.publish).toBe(true);
  });

  it("summary exposes only booleans (no env var names leak)", () => {
    const summary = getPlatformReadinessSummary();
    expect(Object.keys(summary)).toEqual(
      expect.arrayContaining(["etsy", "shopify", "tiktok", "amazon", "depop", "redbubble"]),
    );
    for (const v of Object.values(summary)) expect(typeof v).toBe("boolean");
  });
});
