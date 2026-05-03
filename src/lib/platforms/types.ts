export type PlatformId = "etsy" | "shopify" | "tiktok" | "depop" | "redbubble" | "amazon";

export const ALL_PLATFORM_IDS: PlatformId[] = ["etsy", "shopify", "tiktok", "depop", "redbubble", "amazon"];

export interface PlatformListingResult {
  externalId: string;
  url: string | null;
  state: string;
}

export interface ListingInput {
  title: string;
  description: string;
  price: number;
  tags: string[];
  imageUrls: string[];
  productType: string;
  printifyProductId?: string;
  printifyShopId?: string;
}

export interface PlatformSEOHints {
  titleMaxLength: number;
  maxTags: number;
  tagMaxLength: number;
  descriptionMaxWords: number;
  platformName: string;
  seoGuidance: string;
}

export interface PlatformOrderData {
  externalOrderId: string;
  externalListingId: string;
  status: "new" | "processing" | "shipped" | "delivered" | "cancelled" | "refunded";
  quantity: number;
  revenue: number;
  customerRegion?: string;
  orderedAt: string;
}

export interface PlatformMetricsData {
  externalListingId: string;
  views: number;
  favorites: number;
}

export interface PlatformStrategy {
  id: PlatformId;
  name: string;
  isConfigured(): boolean;
  createDraftListing(data: ListingInput): Promise<PlatformListingResult>;
  uploadImages(externalId: string, imageUrls: string[]): Promise<void>;
  publishListing(externalId: string): Promise<void>;
  deactivateListing(externalId: string): Promise<void>;
  updatePrice(externalId: string, price: number): Promise<void>;
  updateTitle(externalId: string, title: string): Promise<void>;
  fetchRecentOrders(sinceDaysAgo?: number): Promise<PlatformOrderData[]>;
  fetchListingMetrics(externalIds: string[]): Promise<PlatformMetricsData[]>;
  getListingFee(): number;
  getMaxTitleLength(): number;
  getMaxTags(): number;
  getSEOHints(): PlatformSEOHints;
}

export class UnsupportedPlatformOperation extends Error {
  constructor(public readonly platform: PlatformId, public readonly operation: string) {
    super(`Platform ${platform} does not support ${operation}`);
    this.name = "UnsupportedPlatformOperation";
  }
}

export const PLATFORM_DISPLAY: Record<PlatformId, { name: string; color: string }> = {
  etsy: { name: "Etsy", color: "text-orange-600" },
  shopify: { name: "Shopify", color: "text-green-600" },
  tiktok: { name: "TikTok Shop", color: "text-pink-500" },
  depop: { name: "Depop", color: "text-red-500" },
  redbubble: { name: "Redbubble", color: "text-red-600" },
  amazon: { name: "Amazon", color: "text-yellow-600" },
};
