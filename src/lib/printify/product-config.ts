export interface ProductConfig {
  blueprintId: number;
  printProviderId: number;
  displayName: string;
  category: string;
  printAreaWidth: number;
  printAreaHeight: number;
  defaultColors: Array<{ name: string; hex: string }>;
  defaultSizes: string[];
}

const STANDARD_COLORS = [
  { name: "Black", hex: "#0d0d0d" },
  { name: "Navy", hex: "#1a2744" },
  { name: "White", hex: "#ffffff" },
  { name: "Heather Grey", hex: "#9b9b9b" },
];

const APPAREL_SIZES = ["S", "M", "L", "XL", "2XL"];

// Top-selling POD products on Etsy, ordered by profitability.
// Blueprint + provider IDs from Printify's catalog (Monster Digital / SwiftPOD).
export const PRODUCT_CONFIGS: Record<string, ProductConfig> = {
  // --- APPAREL ---
  unisex_tshirt: {
    blueprintId: 145,       // Bella+Canvas 3001 Unisex Jersey
    printProviderId: 99,    // Monster Digital
    displayName: "Unisex T-Shirt",
    category: "apparel",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: STANDARD_COLORS,
    defaultSizes: APPAREL_SIZES,
  },
  hoodie: {
    blueprintId: 77,        // Gildan 18500 Heavy Blend Hoodie
    printProviderId: 99,
    displayName: "Hoodie",
    category: "apparel",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: STANDARD_COLORS,
    defaultSizes: APPAREL_SIZES,
  },
  crewneck_sweatshirt: {
    blueprintId: 180,       // Gildan 18000 Crewneck Sweatshirt
    printProviderId: 99,
    displayName: "Crewneck Sweatshirt",
    category: "apparel",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: STANDARD_COLORS,
    defaultSizes: APPAREL_SIZES,
  },
  tank_top: {
    blueprintId: 297,       // Bella+Canvas 3480 Unisex Tank
    printProviderId: 99,
    displayName: "Tank Top",
    category: "apparel",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: STANDARD_COLORS,
    defaultSizes: APPAREL_SIZES,
  },
  long_sleeve_tee: {
    blueprintId: 228,       // Bella+Canvas 3501 Long Sleeve
    printProviderId: 99,
    displayName: "Long Sleeve Tee",
    category: "apparel",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: STANDARD_COLORS,
    defaultSizes: APPAREL_SIZES,
  },
  vneck_tshirt: {
    blueprintId: 163,       // Bella+Canvas 3005 V-Neck
    printProviderId: 99,
    displayName: "V-Neck T-Shirt",
    category: "apparel",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: STANDARD_COLORS,
    defaultSizes: APPAREL_SIZES,
  },

  // --- DRINKWARE ---
  mug_11oz: {
    blueprintId: 68,        // 11oz White Mug
    printProviderId: 99,
    displayName: "11oz Mug",
    category: "drinkware",
    printAreaWidth: 4500,
    printAreaHeight: 2100,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["11oz"],
  },
  mug_15oz: {
    blueprintId: 69,        // 15oz White Mug
    printProviderId: 99,
    displayName: "15oz Mug",
    category: "drinkware",
    printAreaWidth: 4500,
    printAreaHeight: 2400,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["15oz"],
  },

  // --- BAGS ---
  tote_bag: {
    blueprintId: 187,       // AOP Tote Bag
    printProviderId: 99,
    displayName: "Tote Bag",
    category: "bags",
    printAreaWidth: 4500,
    printAreaHeight: 4500,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["15x15"],
  },

  // --- WALL ART ---
  poster: {
    blueprintId: 169,       // Enhanced Matte Paper Poster
    printProviderId: 99,
    displayName: "Poster",
    category: "wall_art",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["12x16", "18x24", "24x36"],
  },
  canvas_print: {
    blueprintId: 116,       // Canvas Print
    printProviderId: 99,
    displayName: "Canvas Print",
    category: "wall_art",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["12x16", "18x24"],
  },

  // --- ACCESSORIES ---
  phone_case: {
    blueprintId: 233,       // iPhone Tough Case
    printProviderId: 99,
    displayName: "Phone Case",
    category: "accessories",
    printAreaWidth: 1800,
    printAreaHeight: 3200,
    defaultColors: [{ name: "Black", hex: "#0d0d0d" }],
    defaultSizes: ["iPhone 14", "iPhone 15", "iPhone 15 Pro"],
  },
  sticker: {
    blueprintId: 479,       // Kiss-Cut Stickers
    printProviderId: 99,
    displayName: "Sticker",
    category: "accessories",
    printAreaWidth: 2400,
    printAreaHeight: 2400,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["3x3", "4x4", "5.5x5.5"],
  },
  mousepad: {
    blueprintId: 201,       // Rectangle Mouse Pad
    printProviderId: 99,
    displayName: "Mouse Pad",
    category: "accessories",
    printAreaWidth: 4500,
    printAreaHeight: 3600,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["9.25x7.75"],
  },

  // --- HOME ---
  blanket: {
    blueprintId: 462,       // Velveteen Plush Blanket
    printProviderId: 99,
    displayName: "Blanket",
    category: "home",
    printAreaWidth: 4500,
    printAreaHeight: 5400,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["30x40", "50x60", "60x80"],
  },
  throw_pillow: {
    blueprintId: 83,        // Spun Polyester Pillow
    printProviderId: 99,
    displayName: "Throw Pillow",
    category: "home",
    printAreaWidth: 4500,
    printAreaHeight: 4500,
    defaultColors: [{ name: "White", hex: "#ffffff" }],
    defaultSizes: ["14x14", "16x16", "18x18"],
  },
};

export const ALL_PRODUCT_TYPES = Object.keys(PRODUCT_CONFIGS);

export function getProductConfig(type: string): ProductConfig | undefined {
  return PRODUCT_CONFIGS[type];
}

export function getProductDisplayName(type: string): string {
  return PRODUCT_CONFIGS[type]?.displayName ?? type;
}
