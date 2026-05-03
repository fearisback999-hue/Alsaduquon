import * as placeit from "@/lib/external/placeit";
import * as printify from "@/lib/external/printify";
import { persistImage } from "./storage";
import { recordCost } from "@/lib/cost/guard";
import { log } from "@/lib/logger";

// ──────────────────────────────────────────────────────────────
// Lifestyle mockup template IDs per product type.
// Each product gets 2-3 curated Placeit templates chosen for
// high Etsy CTR: lifestyle context, clean lighting, real models.
// ──────────────────────────────────────────────────────────────

interface TemplateSet {
  lifestyle: number[];
  closeup: number[];
}

const PLACEIT_TEMPLATES: Record<string, TemplateSet> = {
  // --- APPAREL ---
  unisex_tshirt: {
    lifestyle: [28561, 28562, 28563, 28580, 28590],
    closeup: [28570, 28571],
  },
  hoodie: {
    lifestyle: [29401, 29402, 29410, 29415],
    closeup: [29420, 29421],
  },
  crewneck_sweatshirt: {
    lifestyle: [30101, 30102, 30110],
    closeup: [30120],
  },
  tank_top: {
    lifestyle: [31201, 31202, 31210],
    closeup: [31220],
  },
  long_sleeve_tee: {
    lifestyle: [32001, 32002, 32010],
    closeup: [32020],
  },
  vneck_tshirt: {
    lifestyle: [32501, 32502, 32510],
    closeup: [32520],
  },

  // --- DRINKWARE ---
  mug_11oz: {
    lifestyle: [40101, 40102, 40110, 40115],
    closeup: [40120],
  },
  mug_15oz: {
    lifestyle: [40201, 40202, 40210],
    closeup: [40220],
  },

  // --- BAGS ---
  tote_bag: {
    lifestyle: [41001, 41002, 41010],
    closeup: [41020],
  },

  // --- WALL ART ---
  poster: {
    lifestyle: [42001, 42002, 42010, 42015],
    closeup: [42020],
  },
  canvas_print: {
    lifestyle: [42501, 42502, 42510],
    closeup: [42520],
  },

  // --- ACCESSORIES ---
  phone_case: {
    lifestyle: [43001, 43002, 43010],
    closeup: [43020],
  },
  sticker: {
    lifestyle: [43501, 43502],
    closeup: [43520],
  },
  mousepad: {
    lifestyle: [44001, 44002],
    closeup: [44020],
  },

  // --- HOME ---
  blanket: {
    lifestyle: [45001, 45002, 45010],
    closeup: [45020],
  },
  throw_pillow: {
    lifestyle: [45501, 45502, 45510],
    closeup: [45520],
  },
};

// Cost per Placeit render (they charge per render, ~$0.10-0.30 depending on plan)
const PLACEIT_COST_PER_RENDER = 0.15;

export interface MockupResult {
  url: string;
  originalUrl: string;
  mockupType: "front" | "back" | "side" | "lifestyle" | "closeup" | "size_chart";
  source: "placeit" | "printify";
  sortOrder: number;
  isPrimary: boolean;
}

export interface GenerateMockupsOptions {
  productId: string;
  productType: string;
  printifyShopId: string;
  printifyProductId: string;
  designImageUrl: string;
  maxLifestyle?: number;
  maxTotal?: number;
}

function getTemplatesForProduct(productType: string): TemplateSet | null {
  return PLACEIT_TEMPLATES[productType] ?? null;
}

async function generateLifestyleMockup(
  templateId: number,
  designImageUrl: string,
  productId: string,
  index: number,
): Promise<{ url: string; originalUrl: string } | null> {
  try {
    const result = await placeit.renderAndWait(templateId, designImageUrl);

    const stored = await persistImage(
      result.resultUrl,
      `mockups/${productId}/lifestyle-${index + 1}.png`,
    );

    await recordCost("other", PLACEIT_COST_PER_RENDER, {
      description: `Placeit lifestyle mockup (template ${templateId})`,
      referenceId: productId,
      referenceType: "mockup",
    });

    return { url: stored.url, originalUrl: result.resultUrl };
  } catch (error) {
    log("warn", `[mockup-provider] Placeit render failed for template ${templateId}`, {
      productId,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

async function fetchPrintifyMockups(
  shopId: string,
  printifyProductId: string,
): Promise<Array<{ src: string; is_default: boolean }>> {
  try {
    const data = await printify.getMockups(shopId, printifyProductId);
    return data.images ?? [];
  } catch (error) {
    log("warn", "[mockup-provider] Printify mockup fetch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return [];
  }
}

/**
 * Generates a full set of mockups for a product:
 * 1. Lifestyle mockups from Placeit (if configured and templates exist)
 * 2. Product shots from Printify as backfill
 *
 * The primary image is always a lifestyle shot when available —
 * lifestyle mockups convert 2-3x better than flat product shots on Etsy.
 */
export async function generateMockups(options: GenerateMockupsOptions): Promise<MockupResult[]> {
  const {
    productId,
    productType,
    printifyShopId,
    printifyProductId,
    designImageUrl,
    maxLifestyle = 3,
    maxTotal = 8,
  } = options;

  const results: MockupResult[] = [];
  let sortOrder = 0;

  // ── Phase 1: Lifestyle mockups from Placeit ──
  if (placeit.isConfigured()) {
    const templates = getTemplatesForProduct(productType);

    if (templates) {
      const lifestyleTemplates = templates.lifestyle.slice(0, maxLifestyle);
      const closeupTemplates = templates.closeup.slice(0, 1);

      // Render lifestyle mockups in parallel (2 at a time to respect rate limits)
      const batchSize = 2;
      for (let i = 0; i < lifestyleTemplates.length; i += batchSize) {
        const batch = lifestyleTemplates.slice(i, i + batchSize);
        const rendered = await Promise.allSettled(
          batch.map((templateId, batchIdx) =>
            generateLifestyleMockup(templateId, designImageUrl, productId, i + batchIdx),
          ),
        );

        for (const result of rendered) {
          if (result.status === "fulfilled" && result.value) {
            sortOrder++;
            results.push({
              url: result.value.url,
              originalUrl: result.value.originalUrl,
              mockupType: "lifestyle",
              source: "placeit",
              sortOrder,
              isPrimary: results.length === 0,
            });
          }
        }
      }

      // One closeup render
      if (closeupTemplates.length > 0 && results.length < maxTotal) {
        const closeup = await generateLifestyleMockup(
          closeupTemplates[0],
          designImageUrl,
          productId,
          results.length,
        );
        if (closeup) {
          sortOrder++;
          results.push({
            url: closeup.url,
            originalUrl: closeup.originalUrl,
            mockupType: "closeup",
            source: "placeit",
            sortOrder,
            isPrimary: results.length === 0,
          });
        }
      }

      if (results.length > 0) {
        log("info", `[mockup-provider] Generated ${results.length} Placeit lifestyle mockups for ${productType}`);
      }
    }
  }

  // ── Phase 2: Printify product shots as backfill ──
  const printifySlots = maxTotal - results.length;
  if (printifySlots > 0) {
    const printifyImages = await fetchPrintifyMockups(printifyShopId, printifyProductId);
    const imagesToUse = printifyImages.slice(0, printifySlots);

    const PRINTIFY_TYPE_MAP: Array<MockupResult["mockupType"]> = [
      "front", "back", "side", "front", "front",
    ];

    for (let i = 0; i < imagesToUse.length; i++) {
      const img = imagesToUse[i];

      let storedUrl: string;
      try {
        const stored = await persistImage(
          img.src,
          `mockups/${productId}/product-${i + 1}.png`,
        );
        storedUrl = stored.url;
      } catch {
        storedUrl = img.src;
      }

      sortOrder++;
      results.push({
        url: storedUrl,
        originalUrl: img.src,
        mockupType: PRINTIFY_TYPE_MAP[i] ?? "front",
        source: "printify",
        sortOrder,
        isPrimary: results.length === 0,
      });
    }
  }

  return results;
}
