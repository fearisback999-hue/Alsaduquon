import type { PlatformStrategy, PlatformListingResult, ListingInput, PlatformSEOHints } from "./types";
import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "@/lib/external/rate-limiter";

const BASE_URL = "https://sellingpartnerapi-na.amazon.com";

let cachedLwaToken: string | null = null;
let lwaTokenExpiresAt = 0;

async function getLwaAccessToken(): Promise<string> {
  if (cachedLwaToken && Date.now() < lwaTokenExpiresAt) {
    return cachedLwaToken;
  }

  const response = await fetch("https://api.amazon.com/auth/o2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: process.env.AMAZON_REFRESH_TOKEN!,
      client_id: process.env.AMAZON_LWA_CLIENT_ID!,
      client_secret: process.env.AMAZON_LWA_CLIENT_SECRET!,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Amazon LWA", response.status, body);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number };
  cachedLwaToken = data.access_token;
  lwaTokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000;
  return data.access_token;
}

async function amazonFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("amazon");

  const token = await getLwaAccessToken();

  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      "x-amz-access-token": token,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Amazon SP-API", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

function generateSku(): string {
  return `NEOPOD-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

export const amazonStrategy: PlatformStrategy = {
  id: "amazon",
  name: "Amazon",

  isConfigured() {
    return !!(
      process.env.AMAZON_SELLER_ID &&
      process.env.AMAZON_MWS_ACCESS_KEY &&
      process.env.AMAZON_REFRESH_TOKEN
    );
  },

  async createDraftListing(data: ListingInput): Promise<PlatformListingResult> {
    const sellerId = process.env.AMAZON_SELLER_ID!;
    const sku = generateSku();

    const result = await withRetry(() =>
      amazonFetch(`/listings/2021-08-01/items/${sellerId}/${sku}`, {
        method: "PUT",
        body: JSON.stringify({
          productType: data.productType,
          requirements: "LISTING",
          attributes: {
            item_name: [{ value: data.title.slice(0, 200), marketplace_id: "ATVPDKIKX0DER" }],
            product_description: [{ value: data.description.slice(0, 2000), marketplace_id: "ATVPDKIKX0DER" }],
            list_price: [{ value: data.price, currency: "USD", marketplace_id: "ATVPDKIKX0DER" }],
            generic_keyword: [{ value: data.tags.slice(0, 5).map((t) => t.slice(0, 50)).join(" "), marketplace_id: "ATVPDKIKX0DER" }],
            fulfillment_channel: [{ value: "DEFAULT", marketplace_id: "ATVPDKIKX0DER" }],
          },
        }),
      }),
    ) as { sku: string; status: string; submissionId: string };

    return {
      externalId: sku,
      url: null,
      state: result.status ?? "draft",
    };
  },

  async uploadImages(externalId: string, imageUrls: string[]): Promise<void> {
    const sellerId = process.env.AMAZON_SELLER_ID!;

    await withRetry(() =>
      amazonFetch("/feeds/2021-06-30/feeds", {
        method: "POST",
        body: JSON.stringify({
          feedType: "POST_PRODUCT_IMAGE_DATA",
          marketplaceIds: ["ATVPDKIKX0DER"],
          inputFeedDocumentId: externalId,
          feedOptions: {
            images: imageUrls.map((url, i) => ({
              sku: externalId,
              imageType: i === 0 ? "Main" : `PT${i}`,
              imageLocation: url,
            })),
          },
        }),
      }),
    );
  },

  async publishListing(externalId: string): Promise<void> {
    const sellerId = process.env.AMAZON_SELLER_ID!;

    await withRetry(() =>
      amazonFetch(`/listings/2021-08-01/items/${sellerId}/${externalId}`, {
        method: "PATCH",
        body: JSON.stringify({
          productType: "SHIRT",
          patches: [{
            op: "replace",
            path: "/attributes/purchasable_offer",
            value: [{ marketplace_id: "ATVPDKIKX0DER", our_price: [{ schedule: [{ value_with_tax: 0 }] }] }],
          }],
        }),
      }),
    );
  },

  async deactivateListing(externalId: string): Promise<void> {
    const sellerId = process.env.AMAZON_SELLER_ID!;

    await withRetry(() =>
      amazonFetch(`/listings/2021-08-01/items/${sellerId}/${externalId}`, {
        method: "DELETE",
      }),
    );
  },

  getListingFee() {
    return 0.99;
  },

  getMaxTitleLength() {
    return 200;
  },

  getMaxTags() {
    return 5;
  },

  getSEOHints(): PlatformSEOHints {
    return {
      titleMaxLength: 200,
      maxTags: 5,
      tagMaxLength: 50,
      descriptionMaxWords: 300,
      platformName: "Amazon",
      seoGuidance:
        "Amazon A9 algorithm rewards relevance + sales velocity. Front-load title with primary keywords. Use all 5 search term fields. Include brand name. Bullet points > long descriptions.",
    };
  },
};
