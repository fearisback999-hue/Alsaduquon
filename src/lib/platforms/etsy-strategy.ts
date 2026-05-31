import type { PlatformStrategy, PlatformListingResult, ListingInput, ListingVariant, PlatformSEOHints, PlatformOrderData, PlatformMetricsData } from "./types";
import { withRetry } from "@/lib/retry";
import * as etsyClient from "@/lib/external/etsy";
import { getEtsyTaxonomyId, getEtsyMaterials } from "@/lib/external/etsy-taxonomy";
import { syncEtsyInventory, parseVariantTitle, type EtsyVariant } from "@/lib/external/etsy-inventory";

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
      // Category + materials derived from the product type so a mug isn't
      // filed under "shirts". who_made / production partners / shipping are
      // applied by the Etsy client from compliance settings.
      taxonomy_id: getEtsyTaxonomyId(data.productType),
      materials: getEtsyMaterials(data.productType),
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

  async syncVariants(externalId: string, productType: string, variants: ListingVariant[]): Promise<boolean> {
    const etsyVariants: EtsyVariant[] = variants.map((v) => {
      const { size, color } = parseVariantTitle(v.title);
      return { size, color, priceCents: v.priceCents, enabled: v.enabled, sku: v.sku };
    });
    return syncEtsyInventory(Number(externalId), getEtsyTaxonomyId(productType), etsyVariants);
  },

  async publishListing(externalId: string): Promise<void> {
    await etsyClient.publishListing(Number(externalId));
  },

  async deactivateListing(externalId: string): Promise<void> {
    await etsyClient.updateListing(Number(externalId), { state: "inactive" });
  },

  async updatePrice(externalId: string, price: number): Promise<void> {
    await etsyClient.updateListing(Number(externalId), { price });
  },

  async updateTitle(externalId: string, title: string): Promise<void> {
    await etsyClient.updateListing(Number(externalId), { title: title.slice(0, 140) });
  },

  async fetchListingMetrics(externalIds: string[]): Promise<PlatformMetricsData[]> {
    const idSet = new Set(externalIds);
    const results: PlatformMetricsData[] = [];
    let offset = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await etsyClient.getShopListings("active", limit, offset);
      const etsyResults = response.results ?? [];

      for (const listing of etsyResults) {
        const listingIdStr = String(listing.listing_id);
        if (idSet.has(listingIdStr)) {
          results.push({
            externalListingId: listingIdStr,
            views: listing.views ?? 0,
            favorites: listing.num_favorers ?? 0,
          });
        }
      }

      offset += limit;
      hasMore = etsyResults.length === limit;
    }

    return results;
  },

  async fetchRecentOrders(sinceDaysAgo = 1): Promise<PlatformOrderData[]> {
    const minCreated = Math.floor((Date.now() - sinceDaysAgo * 24 * 60 * 60 * 1000) / 1000);
    const receipts = await etsyClient.getShopReceipts({ minCreated, limit: 100 });
    const result: PlatformOrderData[] = [];

    for (const receipt of receipts.results) {
      for (const tx of receipt.transactions) {
        result.push({
          externalOrderId: String(receipt.receipt_id),
          externalListingId: String(tx.listing_id),
          status: receipt.status === "paid" ? "processing" : "new",
          quantity: tx.quantity,
          revenue: tx.price.amount / tx.price.divisor,
          orderedAt: new Date().toISOString(),
        });
      }
    }
    return result;
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
