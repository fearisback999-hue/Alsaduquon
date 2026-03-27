interface RateLimiterConfig {
  maxRequests: number;
  windowMs: number;
}

const LIMITS: Record<string, RateLimiterConfig> = {
  printify: { maxRequests: 5, windowMs: 1000 },
  etsy: { maxRequests: 10, windowMs: 1000 },
  openai: { maxRequests: 5, windowMs: 60000 }, // DALL-E 3 rate limit
  podcs: { maxRequests: 10, windowMs: 60000 },
  flying_research: { maxRequests: 10, windowMs: 60000 },
};

const timestamps: Record<string, number[]> = {};

export async function rateLimit(service: string): Promise<void> {
  const config = LIMITS[service];
  if (!config) return;

  if (!timestamps[service]) timestamps[service] = [];

  const now = Date.now();
  timestamps[service] = timestamps[service].filter((t) => now - t < config.windowMs);

  if (timestamps[service].length >= config.maxRequests) {
    const oldestInWindow = timestamps[service][0];
    const waitMs = config.windowMs - (now - oldestInWindow) + 50;
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }

  timestamps[service].push(Date.now());
}
