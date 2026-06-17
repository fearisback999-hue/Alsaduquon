import { getProductConfig } from "@/lib/printify/product-config";

/**
 * Maps a NeoPOD product type to an Etsy taxonomy (category) node.
 *
 * Today every listing was hardcoded to 482 (Clothing > Shirts & Tees), so a
 * mug, poster, or tote shipped filed under "shirts" — wrong category means it
 * surfaces for the wrong searches (or none) and risks being flagged.
 *
 * Etsy taxonomy_id must be a VALID leaf node ID for the create to succeed, and
 * the full table is shop/locale-specific, so we don't hardcode guesses for
 * categories we can't verify. Instead the operator supplies the correct IDs
 * once via ETSY_TAXONOMY_MAP (JSON), keyed by either product type or the
 * product's category. Anything unmapped falls back to the apparel default,
 * which preserves today's behavior rather than risking a broken publish.
 *
 * Find the right IDs at: https://www.etsy.com/developers (getSellerTaxonomyNodes)
 * or via GET /v3/application/seller-taxonomy/nodes.
 *
 * Example:
 *   ETSY_TAXONOMY_MAP={"drinkware":1234,"wall_art":5678,"mug_11oz":91011}
 */

const APPAREL_SHIRTS = 482; // Clothing > Shirts & Tees (verified default)

let cachedMap: Record<string, number> | null = null;

function getOverrideMap(): Record<string, number> {
  if (cachedMap) return cachedMap;
  cachedMap = {};
  const raw = process.env.ETSY_TAXONOMY_MAP;
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const [key, value] of Object.entries(parsed)) {
        const id = typeof value === "number" ? value : parseInt(String(value), 10);
        if (Number.isFinite(id) && id > 0) cachedMap[key.toLowerCase()] = id;
      }
    } catch {
      // Malformed env — ignore and fall back to defaults rather than crash.
    }
  }
  return cachedMap;
}

/**
 * Resolves the Etsy taxonomy_id for a product type. Resolution order:
 *   1. ETSY_TAXONOMY_MAP keyed by exact product type (e.g. "mug_11oz")
 *   2. ETSY_TAXONOMY_MAP keyed by product category (e.g. "drinkware")
 *   3. Apparel shirts default (482)
 */
export function getEtsyTaxonomyId(productType: string): number {
  const map = getOverrideMap();
  const byType = map[productType.toLowerCase()];
  if (byType) return byType;

  const category = getProductConfig(productType)?.category;
  if (category) {
    const byCategory = map[category.toLowerCase()];
    if (byCategory) return byCategory;
  }

  return APPAREL_SHIRTS;
}

// Material declarations Etsy expects per category. Surfaces in search and is
// expected on POD listings. Best-effort defaults; harmless if approximate.
const MATERIALS_BY_CATEGORY: Record<string, string[]> = {
  apparel: ["cotton", "polyester"],
  drinkware: ["ceramic"],
  bags: ["cotton", "canvas"],
  wall_art: ["paper", "canvas"],
  home: ["polyester"],
  accessories: ["polyester"],
};

export function getEtsyMaterials(productType: string): string[] {
  const category = getProductConfig(productType)?.category;
  if (category && MATERIALS_BY_CATEGORY[category]) return MATERIALS_BY_CATEGORY[category];
  return ["cotton"];
}
