import type { PlatformStrategy, PlatformListingResult, ListingInput, PlatformSEOHints } from "./types";
import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "@/lib/external/rate-limiter";

const BASE_URL = "https://webapi.depop.com/api/v2";

async function depopFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("depop");

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.DEPOP_ACCESS_TOKEN!}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Depop", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const depopStrategy: PlatformStrategy = {
  id: "depop",
  name: "Depop",

  isConfigured() {
    return !!process.env.DEPOP_ACCESS_TOKEN;
  },

  async createDraftListing(data: ListingInput): Promise<PlatformListingResult> {
    const hashtags = data.tags.slice(0, 5).map((t) => `#${t.slice(0, 30).replace(/\s+/g, "")}`);
    const descriptionWithTags = `${data.title}\n\n${data.description}\n\n${hashtags.join(" ")}`;

    const result = await withRetry(() =>
      depopFetch("/products", {
        method: "POST",
        body: JSON.stringify({
          description: descriptionWithTags,
          price: { amount: String(data.price), currency: "USD" },
          pictures: data.imageUrls,
          category: data.productType,
          brand: "NeoPOD",
          condition: "brand_new",
          shippingCost: { amount: "0", currency: "USD" },
        }),
      }),
    ) as { id: string; slug: string };

    return {
      externalId: result.id,
      url: `https://www.depop.com/products/${result.slug}`,
      state: "draft",
    };
  },

  async uploadImages(_externalId: string, _imageUrls: string[]): Promise<void> {
    // Depop images are uploaded as part of createDraftListing
  },

  async publishListing(externalId: string): Promise<void> {
    await withRetry(() =>
      depopFetch(`/products/${externalId}/publish`, { method: "PUT" }),
    );
  },

  async deactivateListing(externalId: string): Promise<void> {
    await withRetry(() =>
      depopFetch(`/products/${externalId}/archive`, { method: "PUT" }),
    );
  },

  getListingFee() {
    return 0;
  },

  getMaxTitleLength() {
    return 65;
  },

  getMaxTags() {
    return 5;
  },

  getSEOHints(): PlatformSEOHints {
    return {
      titleMaxLength: 65,
      maxTags: 5,
      tagMaxLength: 30,
      descriptionMaxWords: 200,
      platformName: "Depop",
      seoGuidance:
        "Casual, Gen-Z friendly. Depop has no separate title field, so the first line will become the listing's headline. Use #hashtags in description. Streetwear/fashion language. Keep it authentic and personal. Short sentences.",
    };
  },
};
