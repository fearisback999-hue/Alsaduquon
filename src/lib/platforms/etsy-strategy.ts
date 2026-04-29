import type { PlatformStrategy, PlatformListingResult, ListingInput, PlatformSEOHints } from "./types";
import { withRetry } from "@/lib/retry";
import * as etsyClient from "@/lib/external/etsy";

export const etsyStrategy: PlatformStrategy = {
  id: "etsy",
  name: "Etsy",

  isConfigured() {
    return !!(process.env.ETSY_CLIENT_ID && process.env.ETSY_SHOP_ID);
  },

  async createDraftListing(data: ListingInput): Promise<PlatformListingResult> {
    const result = await etsyClient.createDraftListing({
      title: data.title.slice(0, 140),
      description: data.description,
      price: data.price,
      tags: data.tags.slice(0, 13).map((t) => t.slice(0, 20)),
    });

    return {
      externalId: String(result.listing_id),
      url: result.url ?? null,
      state: result.state,
    };
  },

  async uploadImages(externalId: string, imageUrls: string[]): Promise<void> {
    const listingId = Number(externalId);
    for (let i = 0; i < imageUrls.length; i++) {
      await withRetry(() => etsyClient.uploadListingImage(listingId, imageUrls[i], i + 1));
    }
  },

  async publishListing(externalId: string): Promise<void> {
    await etsyClient.publishListing(Number(externalId));
  },

  async deactivateListing(externalId: string): Promise<void> {
    await etsyClient.updateListing(Number(externalId), { state: "inactive" });
  },

  getListingFee() {
    return 0.20;
  },

  getMaxTitleLength() {
    return 140;
  },

  getMaxTags() {
    return 13;
  },

  getSEOHints(): PlatformSEOHints {
    return {
      titleMaxLength: 140,
      maxTags: 13,
      tagMaxLength: 20,
      descriptionMaxWords: 600,
      platformName: "Etsy",
      seoGuidance:
        "Etsy search favors long-tail keywords in titles. Front-load the most important keywords. Use all 13 tags with unique phrases. Repeat key terms between title, tags, and first paragraph of description.",
    };
  },
};
