interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

const LIMITS: Record<string, RateLimiterConfig> = {
  printify: { maxRequests: 5, windowMs: 1000 },
  etsy: { maxRequests: 10, windowMs: 1000 },
  shopify: { maxRequests: 2, windowMs: 1000 },
  tiktok: { maxRequests: 5, windowMs: 1000 },
  depop: { maxRequests: 3, windowMs: 1000 },
  redbubble: { maxRequests: 3, windowMs: 1000 },
  amazon: { maxRequests: 5, windowMs: 1000 },
  openai: { maxRequests: 5, windowMs: 60000 },
  anthropic: { maxRequests: 5, windowMs: 60000 },
  replicate: { maxRequests: 10, windowMs: 60000 },
  podcs: { maxRequests: 10, windowMs: 60000 },
  flying_research: { maxRequests: 10, windowMs: 60000 },
};

const timestamps: Record<string, number[]> = {};
// Per-service mutex chain: each rateLimit() call awaits the previous one,
// so the check-and-push is serialized and concurrent callers can't all
// slip through the threshold check simultaneously.
const locks: Record<string, Promise<void>> = {};

export async function rateLimit(service: string): Promise<void> {
  const config = LIMITS[service];
  if (!config) return;

  // Serialize per-service: wait for the prior call to finish before doing
  // our check-and-push. Without this, N concurrent callers all read the
  // same array length and all push, exceeding maxRequests.
  const prior = locks[service] ?? Promise.resolve();
  let release!: () => void;
  locks[service] = new Promise<void>((resolve) => { release = resolve; });
  await prior;

  try {
    if (!timestamps[service]) timestamps[service] = [];

    const now = Date.now();
    timestamps[service] = timestamps[service].filter((t) => now - t < config.windowMs);

    if (timestamps[service].length >= config.maxRequests) {
      const oldestInWindow = timestamps[service][0];
      const waitMs = config.windowMs - (now - oldestInWindow) + 50;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
      // After waiting, prune again before recording
      const afterWait = Date.now();
      timestamps[service] = timestamps[service].filter((t) => afterWait - t < config.windowMs);
    }

    timestamps[service].push(Date.now());
  } finally {
    release();
  }
}
