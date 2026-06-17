import type { PlatformId, PlatformStrategy } from "./types";
import { etsyStrategy } from "./etsy-strategy";
import { shopifyStrategy } from "./shopify-strategy";
import { tiktokStrategy } from "./tiktok-strategy";
import { depopStrategy } from "./depop-strategy";
import { redbubbleStrategy } from "./redbubble-strategy";
import { amazonStrategy } from "./amazon-strategy";

const ALL_STRATEGIES: PlatformStrategy[] = [
  etsyStrategy,
  shopifyStrategy,
  tiktokStrategy,
  depopStrategy,
  redbubbleStrategy,
  amazonStrategy,
];

const strategyMap = new Map<PlatformId, PlatformStrategy>(
  ALL_STRATEGIES.map((s) => [s.id, s]),
);

export function getEnabledPlatforms(): PlatformStrategy[] {
  return ALL_STRATEGIES.filter((s) => s.isConfigured());
}

export function getPlatform(id: PlatformId): PlatformStrategy | null {
  const strategy = strategyMap.get(id);
  if (!strategy || !strategy.isConfigured()) return null;
  return strategy;
}

export function getConfiguredPlatformIds(): PlatformId[] {
  return ALL_STRATEGIES.filter((s) => s.isConfigured()).map((s) => s.id);
}
