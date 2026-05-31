import {
  getTaxonomyProperties,
  updateListingInventory,
  type EtsyTaxonomyProperty,
  type EtsyInventoryProduct,
} from "./etsy";
import { log } from "@/lib/logger";

/**
 * A product variant ready to map onto an Etsy variation. size/color are the
 * two axes Etsy POD listings use; priceCents reflects the actual (possibly
 * tease-discounted) price set on Printify.
 */
export interface EtsyVariant {
  size: string | null;
  color: string | null;
  priceCents: number;
  enabled: boolean;
  sku?: string;
}

// ──────────────────────────────────────────────────────────────
// Variant-title parsing
// ──────────────────────────────────────────────────────────────

// Apparel sizes, dimension sizes ("12x16", "18 x 24"), and volume ("11oz").
const SIZE_TOKEN = /^(?:y(?:outh)?\s*)?(?:x{0,3}s|s|m|l|x{0,3}l|\d?xl|\d+\s*[x×]\s*\d+|\d+(?:\.\d+)?\s*oz|nb|\d+m)$/i;

function looksLikeSize(token: string): boolean {
  const t = token.trim();
  if (SIZE_TOKEN.test(t)) return true;
  // "2XL", "3XL", "Youth Small", "Youth XS" etc.
  if (/^\d?x{1,3}l$/i.test(t)) return true;
  if (/^youth\b/i.test(t)) return true;
  return false;
}

/**
 * Splits a Printify variant title ("Black / M", "Heather Grey / 2XL",
 * "12x16") into size + color. Printify orders tokens as "Color / Size" for
 * apparel but isn't perfectly consistent, so we classify each token rather
 * than rely on position.
 */
export function parseVariantTitle(title: string): { size: string | null; color: string | null } {
  const tokens = title.split(/[\/|]/).map((s) => s.trim()).filter(Boolean);
  let size: string | null = null;
  let color: string | null = null;

  for (const token of tokens) {
    if (size === null && looksLikeSize(token)) {
      size = token;
    } else if (color === null) {
      color = token;
    }
  }
  // Single-token titles that are clearly a size (posters: "18x24")
  if (tokens.length === 1 && size === null && looksLikeSize(tokens[0])) {
    size = tokens[0];
    color = null;
  }
  return { size, color };
}

// ──────────────────────────────────────────────────────────────
// Property discovery
// ──────────────────────────────────────────────────────────────

function findProperty(props: EtsyTaxonomyProperty[], needles: string[]): EtsyTaxonomyProperty | null {
  for (const p of props) {
    if (!p.supports_variations) continue;
    const hay = `${p.name} ${p.display_name}`.toLowerCase();
    if (needles.some((n) => hay.includes(n))) return p;
  }
  return null;
}

function matchValueId(prop: EtsyTaxonomyProperty | null, value: string): number | undefined {
  if (!prop?.possible_values?.length) return undefined;
  const v = value.toLowerCase();
  const hit = prop.possible_values.find((pv) => pv.name.toLowerCase() === v);
  return hit?.value_id;
}

// ──────────────────────────────────────────────────────────────
// Sync
// ──────────────────────────────────────────────────────────────

function syncEnabled(): boolean {
  return process.env.ETSY_SYNC_VARIANTS !== "false";
}

/**
 * Adds size/color variations to a freshly-created Etsy listing.
 *
 * Strictly additive and fail-safe: any error (unsupported category, API
 * shape mismatch, network) is caught and logged — the listing remains a
 * valid single-SKU active listing exactly as before. Returns true when
 * variations were applied.
 *
 * NOTE: Etsy's inventory request shape and per-category property IDs cannot
 * be validated offline. This discovers property IDs at runtime from the
 * taxonomy and should be confirmed against a live shop on first run; until
 * then it degrades gracefully to single-SKU.
 */
export async function syncEtsyInventory(
  listingId: number,
  taxonomyId: number,
  variants: EtsyVariant[],
): Promise<boolean> {
  if (!syncEnabled()) return false;

  // De-dupe identical (size,color) combos and drop disabled ones.
  const seen = new Set<string>();
  const usable = variants.filter((v) => {
    if (!v.enabled) return false;
    if (!v.size && !v.color) return false;
    const key = `${v.size ?? ""}|${v.color ?? ""}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Nothing to vary on — leave it single-SKU.
  if (usable.length < 2) return false;

  const hasSize = usable.some((v) => v.size);
  const hasColor = usable.some((v) => v.color);

  try {
    const props = await getTaxonomyProperties(taxonomyId);
    const sizeProp = hasSize ? findProperty(props, ["size"]) : null;
    const colorProp = hasColor ? findProperty(props, ["primary color", "color"]) : null;

    if (!sizeProp && !colorProp) {
      log("info", `[etsy-inventory] Taxonomy ${taxonomyId} exposes no size/color variation property — keeping single SKU`);
      return false;
    }

    const usedPropertyIds: number[] = [];
    if (sizeProp) usedPropertyIds.push(sizeProp.property_id);
    if (colorProp) usedPropertyIds.push(colorProp.property_id);

    const products: EtsyInventoryProduct[] = usable.map((v) => {
      const property_values: EtsyInventoryProduct["property_values"] = [];
      if (sizeProp && v.size) {
        const valueId = matchValueId(sizeProp, v.size);
        property_values.push({
          property_id: sizeProp.property_id,
          property_name: sizeProp.display_name || "Size",
          values: [v.size],
          ...(valueId ? { value_ids: [valueId] } : {}),
        });
      }
      if (colorProp && v.color) {
        const valueId = matchValueId(colorProp, v.color);
        property_values.push({
          property_id: colorProp.property_id,
          property_name: colorProp.display_name || "Color",
          values: [v.color],
          ...(valueId ? { value_ids: [valueId] } : {}),
        });
      }
      return {
        ...(v.sku ? { sku: v.sku } : {}),
        property_values,
        offerings: [{ price: Math.round(v.priceCents) / 100, quantity: 999, is_enabled: true }],
      };
    });

    // Price can differ per combo (tease hook, size upcharges), so the price
    // varies on every property we're using.
    await updateListingInventory(listingId, products, usedPropertyIds);
    log("info", `[etsy-inventory] Applied ${products.length} variations to listing ${listingId} (size=${!!sizeProp}, color=${!!colorProp})`);
    return true;
  } catch (error) {
    // Never let a variation failure break a published listing.
    log("warn", `[etsy-inventory] Variation sync failed for listing ${listingId}; keeping single SKU`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}
