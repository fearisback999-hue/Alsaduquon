import { type PlatformStrategy, type PlatformListingResult, type ListingInput, type PlatformSEOHints, UnsupportedPlatformOperation } from "./types";
import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "@/lib/external/rate-limiter";

const BASE_URL = "https://www.redbubble.com/api/v1";

async function redbubbleFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("redbubble");

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "X-API-Key": process.env.REDBUBBLE_API_KEY!,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Redbubble", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function downloadImageAsBase64(url: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new ExternalAPIError("ImageDownload", response.status, `Failed to download image from ${url}`);
  }
  const buffer = await response.arrayBuffer();
  return Buffer.from(buffer).toString("base64");
}

export const redbubbleStrategy: PlatformStrategy = {
  id: "redbubble",
  name: "Redbubble",

  isConfigured() {
    return !!(process.env.REDBUBBLE_API_KEY && process.env.REDBUBBLE_ACCOUNT_ID);
  },

  async createDraftListing(data: ListingInput): Promise<PlatformListingResult> {
    if (data.imageUrls.length === 0) {
      throw new ExternalAPIError("Redbubble", 400, "Cannot create Redbubble artwork without an image");
    }
    const imageBase64 = await downloadImageAsBase64(data.imageUrls[0]);

    const result = await withRetry(() =>
      redbubbleFetch("/artworks", {
        method: "POST",
        body: JSON.stringify({
          account_id: process.env.REDBUBBLE_ACCOUNT_ID!,
          title: data.title.slice(0, 50),
          description: data.description,
          tags: data.tags.slice(0, 15).map((t) => t.slice(0, 25)),
          image: imageBase64,
          default_products: ["t-shirt", "sticker", "poster", "phone-case"],
        }),
      }),
    ) as { id: string; url: string };

    return {
      externalId: result.id,
      url: result.url ?? null,
      state: "draft",
    };
  },

  async uploadImages(_externalId: string, _imageUrls: string[]): Promise<void> {
    // Redbubble images are uploaded as part of createDraftListing
  },

  async publishListing(externalId: string): Promise<void> {
    await withRetry(() =>
      redbubbleFetch(`/artworks/${externalId}/publish`, { method: "PUT" }),
    );
  },

  async deactivateListing(externalId: string): Promise<void> {
    await withRetry(() =>
      redbubbleFetch(`/artworks/${externalId}/unpublish`, { method: "PUT" }),
    );
  },

  async updateTitle(_externalId: string, _title: string): Promise<void> {
    // Redbubble artworks are immutable after publishing — title cannot be edited.
    throw new UnsupportedPlatformOperation("redbubble", "updateTitle");
  },

  async updatePrice(_externalId: string, _price: number): Promise<void> {
    // Redbubble pricing is set per product type via markup percentage on the
    // artist account, not per individual artwork. Per-listing price updates
    // are not supported by the public API.
    throw new UnsupportedPlatformOperation("redbubble", "updatePrice");
  },

  getListingFee() {
    return 0;
  },

  getMaxTitleLength() {
    return 50;
  },

  getMaxTags() {
    return 15;
  },

  getSEOHints(): PlatformSEOHints {
    return {
      titleMaxLength: 50,
      maxTags: 15,
      tagMaxLength: 25,
      descriptionMaxWords: 300,
      platformName: "Redbubble",
      seoGuidance:
        "Redbubble search is tag-driven. Use specific, descriptive tags. Include style, theme, and audience tags. Title should be descriptive.",
    };
  },
};
