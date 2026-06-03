import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "./rate-limiter";
import { fetchWithTimeout } from "./fetch-timeout";

const BASE_URL = "https://openapi.etsy.com/v3";

// OAuth 2.0 token management
let cachedAccessToken: string | null = null;
let tokenExpiresAt = 0;
// Dedupe concurrent refreshes — many OAuth providers invalidate a refresh token
// after a single use, so parallel refreshes would kill each other.
let refreshInFlight: Promise<string> | null = null;

async function doRefresh(): Promise<string> {
  const response = await fetchWithTimeout("https://api.etsy.com/v3/public/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: process.env.ETSY_CLIENT_ID!,
      redirect_uri: "https://localhost",
      refresh_token: process.env.ETSY_REFRESH_TOKEN!,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Etsy OAuth", response.status, `Token refresh failed: ${body}`);
  }

  const data = (await response.json()) as { access_token: string; expires_in: number; refresh_token: string };

  cachedAccessToken = data.access_token;
  tokenExpiresAt = Date.now() + (data.expires_in - 60) * 1000; // Refresh 60s before expiry

  return data.access_token;
}

async function refreshAccessToken(): Promise<string> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = doRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function getAccessToken(): Promise<string> {
  if (cachedAccessToken && Date.now() < tokenExpiresAt) {
    return cachedAccessToken;
  }
  return refreshAccessToken();
}

async function etsyFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("etsy");
  const token = await getAccessToken();

  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "x-api-key": process.env.ETSY_CLIENT_ID!,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Etsy", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

/**
 * Production-partner IDs come from the shop's Etsy settings (Shop Manager →
 * Settings → Production partners) and must be referenced on every POD listing.
 * Set ETSY_PRODUCTION_PARTNER_IDS to a comma-separated list of those numeric
 * IDs. Without them, Etsy treats mass-produced items as falsely "handmade" —
 * a policy violation that gets POD shops suspended.
 */
function getProductionPartnerIds(): number[] {
  return (process.env.ETSY_PRODUCTION_PARTNER_IDS ?? "")
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => Number.isFinite(n) && n > 0);
}

export async function createDraftListing(data: {
  title: string;
  description: string;
  price: number;
  tags: string[];
  quantity?: number;
  who_made?: string;
  when_made?: string;
  taxonomy_id?: number;
  shipping_profile_id?: number;
  materials?: string[];
  production_partner_ids?: number[];
}): Promise<{ listing_id: number; url: string; state: string }> {
  const shopId = process.env.ETSY_SHOP_ID!;
  const productionPartnerIds = data.production_partner_ids ?? getProductionPartnerIds();
  const shippingProfileId = data.shipping_profile_id
    ?? (process.env.ETSY_SHIPPING_PROFILE_ID ? Number(process.env.ETSY_SHIPPING_PROFILE_ID) : undefined);
  const returnPolicyId = process.env.ETSY_RETURN_POLICY_ID ? Number(process.env.ETSY_RETURN_POLICY_ID) : undefined;

  return withRetry(() =>
    etsyFetch(`/application/shops/${shopId}/listings`, {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        price: { amount: Math.round(data.price * 100), divisor: 100, currency_code: "USD" },
        quantity: data.quantity ?? 999,
        tags: data.tags.slice(0, 13),
        // POD compliance: the items are produced by a partner, made to order.
        // Declaring "i_did" on mass-produced goods is the misrepresentation
        // Etsy bans shops for.
        who_made: data.who_made ?? "i_did_not",
        when_made: data.when_made ?? "made_to_order",
        taxonomy_id: data.taxonomy_id ?? 482, // Clothing > Shirts & Tees (override per product type)
        type: "physical",
        is_digital: false,
        state: "draft",
        ...(data.materials && data.materials.length > 0 && { materials: data.materials.slice(0, 13) }),
        ...(productionPartnerIds.length > 0 && { production_partner_ids: productionPartnerIds }),
        ...(shippingProfileId && { shipping_profile_id: shippingProfileId }),
        ...(returnPolicyId && { return_policy_id: returnPolicyId }),
      }),
    }),
  ) as Promise<{ listing_id: number; url: string; state: string }>;
}

export async function uploadListingImage(
  listingId: number,
  imageUrl: string,
  rank: number = 1,
): Promise<{ listing_image_id: number }> {
  const shopId = process.env.ETSY_SHOP_ID!;

  await rateLimit("etsy");

  const imageResponse = await fetch(imageUrl);
  if (!imageResponse.ok) {
    throw new ExternalAPIError("ImageDownload", imageResponse.status, `Failed to download image from ${imageUrl}`);
  }
  const imageBuffer = await imageResponse.arrayBuffer();
  const blob = new Blob([imageBuffer], { type: "image/png" });

  const formData = new FormData();
  formData.append("image", blob, `mockup-${rank}.png`);
  formData.append("rank", String(rank));

  const token = await getAccessToken();

  const response = await fetch(
    `${BASE_URL}/application/shops/${shopId}/listings/${listingId}/images`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "x-api-key": process.env.ETSY_CLIENT_ID!,
      },
      body: formData,
    },
  );

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Etsy", response.status, `Image upload failed: ${body}`);
  }

  return response.json() as Promise<{ listing_image_id: number }>;
}

export async function publishListing(listingId: number): Promise<void> {
  const shopId = process.env.ETSY_SHOP_ID!;
  await withRetry(() =>
    etsyFetch(`/application/shops/${shopId}/listings/${listingId}`, {
      method: "PATCH",
      body: JSON.stringify({ state: "active" }),
    }),
  );
}

export async function getListing(listingId: number): Promise<unknown> {
  return withRetry(() => etsyFetch(`/application/listings/${listingId}`));
}

export interface EtsyTaxonomyProperty {
  property_id: number;
  name: string;
  display_name: string;
  supports_variations: boolean;
  is_required: boolean;
  possible_values: Array<{ value_id: number; name: string }>;
  scales: Array<{ scale_id: number; display_name: string }>;
}

// Taxonomy properties are static per category (and per locale, which is fixed
// for the shop), so we cache them for the process lifetime. A batch of listings
// in one pipeline run otherwise refetches the same node properties once per
// listing, burning rate-limit budget on an answer that never changes.
const taxonomyPropertyCache = new Map<number, EtsyTaxonomyProperty[]>();

/**
 * Fetches the variation properties Etsy allows for a taxonomy node — this is
 * how we learn the correct property_id for "Size" / "Color" in a given
 * category instead of hardcoding IDs that differ per category and locale.
 */
export async function getTaxonomyProperties(taxonomyId: number): Promise<EtsyTaxonomyProperty[]> {
  const cached = taxonomyPropertyCache.get(taxonomyId);
  if (cached) return cached;

  const data = (await withRetry(() =>
    etsyFetch(`/application/seller-taxonomy/nodes/${taxonomyId}/properties`),
  )) as { results?: EtsyTaxonomyProperty[] };
  const results = data.results ?? [];
  taxonomyPropertyCache.set(taxonomyId, results);
  return results;
}

export interface EtsyInventoryProduct {
  sku?: string;
  property_values: Array<{
    property_id: number;
    property_name?: string;
    scale_id?: number;
    value_ids?: number[];
    values: string[];
  }>;
  offerings: Array<{ price: number; quantity: number; is_enabled: boolean }>;
}

/**
 * Replaces a listing's inventory with size/color variations. Etsy's inventory
 * model: one "product" per variation combo, each with property_values and a
 * single offering (price/quantity). price_on_property lists the properties
 * whose value changes the price.
 */
export async function updateListingInventory(
  listingId: number,
  products: EtsyInventoryProduct[],
  priceOnProperty: number[],
): Promise<void> {
  await withRetry(() =>
    etsyFetch(`/application/listings/${listingId}/inventory`, {
      method: "PUT",
      body: JSON.stringify({
        products,
        price_on_property: priceOnProperty,
        quantity_on_property: [],
        sku_on_property: [],
      }),
    }),
  );
}

export async function updateListing(
  listingId: number,
  data: { title?: string; description?: string; price?: number; tags?: string[]; state?: string },
): Promise<unknown> {
  const shopId = process.env.ETSY_SHOP_ID!;
  const body: Record<string, unknown> = {};
  if (data.title) body.title = data.title;
  if (data.description) body.description = data.description;
  if (data.price) body.price = { amount: Math.round(data.price * 100), divisor: 100, currency_code: "USD" };
  if (data.tags) body.tags = data.tags.slice(0, 13);
  if (data.state) body.state = data.state;

  return withRetry(() =>
    etsyFetch(`/application/shops/${shopId}/listings/${listingId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),
  );
}

export async function getShopReceipts(
  options?: { minCreated?: number; maxCreated?: number; limit?: number; offset?: number },
): Promise<{ count: number; results: Array<{ receipt_id: number; order_id: number; status: string; grandtotal: { amount: number; divisor: number }; transactions: Array<{ listing_id: number; quantity: number; price: { amount: number; divisor: number } }> }> }> {
  const shopId = process.env.ETSY_SHOP_ID!;
  const params = new URLSearchParams();
  if (options?.minCreated) params.set("min_created", String(options.minCreated));
  if (options?.maxCreated) params.set("max_created", String(options.maxCreated));
  if (options?.limit) params.set("limit", String(options.limit));
  if (options?.offset) params.set("offset", String(options.offset));

  const query = params.toString() ? `?${params.toString()}` : "";
  return withRetry(() =>
    etsyFetch(`/application/shops/${shopId}/receipts${query}`),
  ) as Promise<{ count: number; results: Array<{ receipt_id: number; order_id: number; status: string; grandtotal: { amount: number; divisor: number }; transactions: Array<{ listing_id: number; quantity: number; price: { amount: number; divisor: number } }> }> }>;
}

export async function getShopReviews(
  limit = 25,
  offset = 0,
): Promise<{ count: number; results: Array<{ review_id: number; listing_id: number; rating: number; review: string; created_timestamp: number }> }> {
  const shopId = process.env.ETSY_SHOP_ID!;
  return withRetry(() =>
    etsyFetch(`/application/shops/${shopId}/reviews?limit=${limit}&offset=${offset}`),
  ) as Promise<{ count: number; results: Array<{ review_id: number; listing_id: number; rating: number; review: string; created_timestamp: number }> }>;
}

export async function getShopListings(
  state?: "active" | "inactive" | "draft" | "expired",
  limit: number = 25,
  offset: number = 0,
): Promise<{ count: number; results: Array<{ listing_id: number; title: string; state: string; views: number; num_favorers: number }> }> {
  const shopId = process.env.ETSY_SHOP_ID!;
  const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
  if (state) params.set("state", state);

  return withRetry(() =>
    etsyFetch(`/application/shops/${shopId}/listings?${params.toString()}`),
  ) as Promise<{ count: number; results: Array<{ listing_id: number; title: string; state: string; views: number; num_favorers: number }> }>;
}
