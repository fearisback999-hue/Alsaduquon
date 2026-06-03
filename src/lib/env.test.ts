import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("validateEnv", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("passes when SKIP_ENV_VALIDATION is set", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "1");
    const { validateEnv } = await import("./env");
    expect(validateEnv().valid).toBe(true);
  });

  it("fails in dev when OPENAI_API_KEY is missing", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("ADMIN_PASSWORD", "test");
    const { validateEnv } = await import("./env");
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.missing).toContain("OPENAI_API_KEY");
  });

  it("passes in dev with only OPENAI_API_KEY and ADMIN_PASSWORD", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ADMIN_PASSWORD", "test");
    const { validateEnv } = await import("./env");
    expect(validateEnv().valid).toBe(true);
  });

  it("requires more keys in production", async () => {
    vi.stubEnv("SKIP_ENV_VALIDATION", "");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("OPENAI_API_KEY", "sk-test");
    vi.stubEnv("ADMIN_PASSWORD", "test");
    const { validateEnv } = await import("./env");
    const result = validateEnv();
    expect(result.valid).toBe(false);
    expect(result.missing.length).toBeGreaterThan(0);
  });
});
