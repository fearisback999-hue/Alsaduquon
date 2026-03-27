import type { ProductType } from "@/lib/types";

export interface ProductConfig {
  blueprintId: number;
  printProviderId: number;
  printAreaWidth: number;
  printAreaHeight: number;
  defaultColors: Array<{ name: string; hex: string }>;
  defaultSizes: string[];
}

// These IDs come from Printify's catalog — update after confirming with their API
export const PRODUCT_CONFIGS: Record<ProductType, ProductConfig> = {
  premium_tshirt: {
    blueprintId: 145,    // Bella+Canvas 3001 Unisex Jersey
    printProviderId: 99,  // Monster Digital
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: [
      { name: "Black", hex: "#0d0d0d" },
      { name: "Navy", hex: "#1a2744" },
      { name: "White", hex: "#ffffff" },
      { name: "Heather Grey", hex: "#9b9b9b" },
    ],
    defaultSizes: ["S", "M", "L", "XL", "2XL"],
  },
  hoodie: {
    blueprintId: 77,      // Gildan 18500 Heavy Blend Hoodie
    printProviderId: 99,
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: [
      { name: "Black", hex: "#0d0d0d" },
      { name: "Navy", hex: "#1a2744" },
      { name: "White", hex: "#ffffff" },
      { name: "Sport Grey", hex: "#9b9b9b" },
    ],
    defaultSizes: ["S", "M", "L", "XL", "2XL"],
  },
  blanket: {
    blueprintId: 462,     // Velveteen Plush Blanket
    printProviderId: 99,
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: [
      { name: "White", hex: "#ffffff" },
    ],
    defaultSizes: ["30x40", "50x60", "60x80"],
  },
};

export function getProductConfig(type: ProductType): ProductConfig {
  return PRODUCT_CONFIGS[type];
}
