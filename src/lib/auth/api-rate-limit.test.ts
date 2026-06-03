import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { apiRateLimit } from "./api-rate-limit";

describe("apiRateLimit", () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it("allows requests within the limit", () => {
    expect(apiRateLimit("test-a", 3, 60_000).allowed).toBe(true);
    expect(apiRateLimit("test-a", 3, 60_000).allowed).toBe(true);
    expect(apiRateLimit("test-a", 3, 60_000).allowed).toBe(true);
  });

  it("blocks the request that exceeds the limit", () => {
    apiRateLimit("test-b", 2, 60_000);
    apiRateLimit("test-b", 2, 60_000);
    const result = apiRateLimit("test-b", 2, 60_000);
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets after the window expires", () => {
    apiRateLimit("test-c", 1, 1000);
    expect(apiRateLimit("test-c", 1, 1000).allowed).toBe(false);
    vi.advanceTimersByTime(1001);
    expect(apiRateLimit("test-c", 1, 1000).allowed).toBe(true);
  });

  it("tracks different keys independently", () => {
    apiRateLimit("key-1", 1, 60_000);
    expect(apiRateLimit("key-1", 1, 60_000).allowed).toBe(false);
    expect(apiRateLimit("key-2", 1, 60_000).allowed).toBe(true);
  });
});
