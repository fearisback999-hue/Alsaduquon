import type { PlatformStrategy, PlatformListingResult, ListingInput, PlatformSEOHints } from "./types";
import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "@/lib/external/rate-limiter";
import { createHmac } from "crypto";

const BASE_URL = "https://open-api.tiktokglobalshop.com";

function signRequest(path: string, params: Record<string, string>, body?: string): string {
  const appSecret = process.env.TIKTOK_SHOP_APP_SECRET ?? "";
  const sortedParams = Object.keys(params).sort().map((k) => `${k}${params[k]}`).join("");
  const baseString = `${appSecret}${path}${sortedParams}${body ?? ""}${appSecret}`;
  return createHmac("sha256", appSecret).update(baseString).digest("hex");
}

async function tiktokFetch(path: string, options?: RequestInit & { body?: string }): Promise<unknown> {
  await rateLimit("tiktok");

  const params: Record<string, string> = {
    app_key: process.env.TIKTOK_SHOP_APP_KEY!,
    access_token: process.env.TIKTOK_SHOP_ACCESS_TOKEN!,
    timestamp: String(Math.floor(Date.now() / 1000)),
  };

  const sign = signRequest(path, params, options?.body);
  params.sign = sign;

  const query = new URLSearchParams(params).toString();

  const response = await fetch(`${BASE_URL}${path}?${query}`, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("TikTok Shop", response.status, body);
  }

  const json = (await response.json()) as { code: number; message: string; data: unknown };
  if (json.code !== 0) {
    throw new ExternalAPIError("TikTok Shop", json.code, json.message);
  }

  return json.data;
}

export const tiktokStrategy: PlatformStrategy = {
  id: "tiktok",
  name: "TikTok Shop",

  isConfigured() {
    return !!(process.env.TIKTOK_SHOP_APP_KEY && process.env.TIKTOK_SHOP_ACCESS_TOKEN);
  },

  async createDraftListing(data: ListingInput): Promise<PlatformListingResult> {
    const result = await withRetry(() =>
      tiktokFetch("/api/products", {
        method: "POST",
        body: JSON.stringify({
          product_name: data.title.slice(0, 100),
          description: data.description,
          category_id: "601226",
          images: data.imageUrls.map((url) => ({ url })),
          skus: [{
            original_price: String(data.price),
            stock_infos: [{ available_stock: 999 }],
          }],
          product_status: 1, // draft
        }),
      }),
    ) as { product_id: string };

    return {
      externalId: result.product_id,
      url: null,
      state: "draft",
    };
  },

  async uploadImages(_externalId: string, imageUrls: string[]): Promise<void> {
    for (const url of imageUrls) {
      await withRetry(() =>
        tiktokFetch("/api/products/upload_imgs", {
          method: "POST",
          body: JSON.stringify({ img_url: url }),
        }),
      );
    }
  },

  async publishListing(externalId: string): Promise<void> {
    await withRetry(() =>
      tiktokFetch("/api/products/activate", {
        method: "POST",
        body: JSON.stringify({ product_ids: [externalId] }),
      }),
    );
  },

  async deactivateListing(externalId: string): Promise<void> {
    await withRetry(() =>
      tiktokFetch("/api/products/deactivate", {
        method: "POST",
        body: JSON.stringify({ product_ids: [externalId] }),
      }),
    );
  },

  async updateTitle(externalId: string, title: string): Promise<void> {
    await withRetry(() =>
      tiktokFetch("/api/products", {
        method: "PUT",
        body: JSON.stringify({ product_id: externalId, product_name: title.slice(0, 100) }),
      }),
    );
  },

  async updatePrice(externalId: string, price: number): Promise<void> {
    await withRetry(() =>
      tiktokFetch("/api/products/prices/update", {
        method: "POST",
        body: JSON.stringify({
          product_id: externalId,
          skus: [{ original_price: String(price) }],
        }),
      }),
    );
  },

  getListingFee() {
    return 0;
  },

  getMaxTitleLength() {
    return 100;
  },

  getMaxTags() {
    return 0;
  },

  getSEOHints(): PlatformSEOHints {
    return {
      titleMaxLength: 100,
      maxTags: 0,
      tagMaxLength: 0,
      descriptionMaxWords: 300,
      platformName: "TikTok Shop",
      seoGuidance:
        "Short, punchy titles. Emoji-friendly. Trending language. Focus on visual appeal description. Gen-Z friendly tone.",
    };
  },
};
