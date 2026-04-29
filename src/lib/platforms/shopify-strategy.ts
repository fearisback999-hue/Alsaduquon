import type { PlatformStrategy, PlatformListingResult, ListingInput, PlatformSEOHints } from "./types";
import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "@/lib/external/rate-limiter";

function getBaseUrl(): string {
  return `https://${process.env.SHOPIFY_STORE_URL}/admin/api/2024-01`;
}

async function shopifyFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("shopify");

  const response = await fetch(`${getBaseUrl()}${path}`, {
    ...options,
    headers: {
      "X-Shopify-Access-Token": process.env.SHOPIFY_ACCESS_TOKEN!,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Shopify", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

export const shopifyStrategy: PlatformStrategy = {
  id: "shopify",
  name: "Shopify",

  isConfigured() {
    return !!(process.env.SHOPIFY_STORE_URL && process.env.SHOPIFY_ACCESS_TOKEN);
  },

  async createDraftListing(data: ListingInput): Promise<PlatformListingResult> {
    const result = await withRetry(() =>
      shopifyFetch("/products.json", {
        method: "POST",
        body: JSON.stringify({
          product: {
            title: data.title.slice(0, 255),
            body_html: data.description,
            vendor: "NeoPOD",
            product_type: data.productType,
            tags: data.tags.join(", "),
            variants: [{ price: String(data.price) }],
            status: "draft",
          },
        }),
      }),
    ) as { product: { id: number; status: string } };

    return {
      externalId: String(result.product.id),
      url: `https://${process.env.SHOPIFY_STORE_URL}/admin/products/${result.product.id}`,
      state: "draft",
    };
  },

  async uploadImages(externalId: string, imageUrls: string[]): Promise<void> {
    for (const url of imageUrls) {
      await withRetry(() =>
        shopifyFetch(`/products/${externalId}/images.json`, {
          method: "POST",
          body: JSON.stringify({ image: { src: url } }),
        }),
      );
    }
  },

  async publishListing(externalId: string): Promise<void> {
    await withRetry(() =>
      shopifyFetch(`/products/${externalId}.json`, {
        method: "PUT",
        body: JSON.stringify({ product: { id: Number(externalId), status: "active" } }),
      }),
    );
  },

  async deactivateListing(externalId: string): Promise<void> {
    await withRetry(() =>
      shopifyFetch(`/products/${externalId}.json`, {
        method: "PUT",
        body: JSON.stringify({ product: { id: Number(externalId), status: "draft" } }),
      }),
    );
  },

  getListingFee() {
    return 0;
  },

  getMaxTitleLength() {
    return 255;
  },

  getMaxTags() {
    return 250;
  },

  getSEOHints(): PlatformSEOHints {
    return {
      titleMaxLength: 255,
      maxTags: 250,
      tagMaxLength: 255,
      descriptionMaxWords: 800,
      platformName: "Shopify",
      seoGuidance:
        "Focus on Google SEO. Use product-focused keywords. Include brand name. Longer descriptions with feature bullets perform well.",
    };
  },
};
