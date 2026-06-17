import { ExternalAPIError } from "@/lib/errors";
import { withRetry } from "@/lib/retry";
import { rateLimit } from "./rate-limiter";
import { fetchWithTimeout } from "./fetch-timeout";

const BASE_URL = "https://api.printify.com/v1";

async function printifyFetch(path: string, options?: RequestInit): Promise<unknown> {
  await rateLimit("printify");

  const response = await fetchWithTimeout(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.PRINTIFY_API_TOKEN}`,
      "Content-Type": "application/json",
      ...options?.headers,
    },
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new ExternalAPIError("Printify", response.status, body);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function getShop(): Promise<{ id: string; title: string }> {
  const shops = (await withRetry(() => printifyFetch("/shops.json"))) as Array<{ id: number; title: string }>;
  const shopId = process.env.PRINTIFY_SHOP_ID;
  const shop = shops.find((s) => String(s.id) === shopId) ?? shops[0];
  return { id: String(shop.id), title: shop.title };
}

export async function uploadImage(
  fileName: string,
  base64Data: string,
): Promise<{ id: string; file_name: string; preview_url: string }> {
  return withRetry(() =>
    printifyFetch("/uploads/images.json", {
      method: "POST",
      body: JSON.stringify({ file_name: fileName, contents: base64Data }),
    }),
  ) as Promise<{ id: string; file_name: string; preview_url: string }>;
}

export async function createProduct(
  shopId: string,
  data: {
    title: string;
    description: string;
    blueprintId: number;
    printProviderId: number;
    variants: Array<{ id: number; price: number; is_enabled: boolean }>;
    printAreas: Array<{ variant_ids: number[]; placeholders: Array<{ position: string; images: Array<{ id: string; x: number; y: number; scale: number; angle: number }> }> }>;
  },
): Promise<{ id: string; title: string; images: Array<{ src: string }> }> {
  return withRetry(() =>
    printifyFetch(`/shops/${shopId}/products.json`, {
      method: "POST",
      body: JSON.stringify({
        title: data.title,
        description: data.description,
        blueprint_id: data.blueprintId,
        print_provider_id: data.printProviderId,
        variants: data.variants,
        print_areas: data.printAreas,
      }),
    }),
  ) as Promise<{ id: string; title: string; images: Array<{ src: string }> }>;
}

export async function getProduct(shopId: string, productId: string): Promise<unknown> {
  return withRetry(() => printifyFetch(`/shops/${shopId}/products/${productId}.json`));
}

export async function publishProduct(shopId: string, productId: string): Promise<void> {
  await withRetry(() =>
    printifyFetch(`/shops/${shopId}/products/${productId}/publish.json`, {
      method: "POST",
      body: JSON.stringify({
        title: true,
        description: true,
        images: true,
        variants: true,
        tags: true,
        keyFeatures: true,
        shipping_template: true,
      }),
    }),
  );
}

export async function getBlueprints(): Promise<Array<{ id: number; title: string }>> {
  return withRetry(() => printifyFetch("/catalog/blueprints.json")) as Promise<Array<{ id: number; title: string }>>;
}

export async function getBlueprintProviders(blueprintId: number): Promise<Array<{ id: number; title: string }>> {
  return withRetry(() =>
    printifyFetch(`/catalog/blueprints/${blueprintId}/print_providers.json`),
  ) as Promise<Array<{ id: number; title: string }>>;
}

export async function getVariants(
  blueprintId: number,
  printProviderId: number,
): Promise<{ variants: Array<{ id: number; title: string; options: Record<string, unknown> }> }> {
  return withRetry(() =>
    printifyFetch(`/catalog/blueprints/${blueprintId}/print_providers/${printProviderId}/variants.json`),
  ) as Promise<{ variants: Array<{ id: number; title: string; options: Record<string, unknown> }> }>;
}

export async function getMockups(shopId: string, productId: string): Promise<{ images: Array<{ src: string; variant_ids: number[]; is_default: boolean }> }> {
  // Printify mockup generation is async — poll until ready
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    const result = (await withRetry(() =>
      printifyFetch(`/shops/${shopId}/products/${productId}/images.json`),
    )) as { images: Array<{ src: string; variant_ids: number[]; is_default: boolean }> };

    if (result.images && result.images.length > 0) return result;

    // Wait before polling again
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }

  return { images: [] };
}

export async function getOrders(shopId: string, page: number = 1): Promise<{ current_page: number; data: Array<unknown> }> {
  return withRetry(() =>
    printifyFetch(`/shops/${shopId}/orders.json?page=${page}`),
  ) as Promise<{ current_page: number; data: Array<unknown> }>;
}
