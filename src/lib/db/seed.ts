import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { settings } from "./schema";
import { eq } from "drizzle-orm";

const DEFAULT_SETTINGS = [
  // Pipeline
  { key: "niche_score_threshold", value: "7.5", type: "number" as const, group: "pipeline" as const, description: "Minimum composite score for a niche to pass scoring" },
  { key: "concepts_per_niche", value: "5", type: "number" as const, group: "pipeline" as const, description: "Number of design concepts generated per approved niche" },
  { key: "max_image_attempts", value: "3", type: "number" as const, group: "pipeline" as const, description: "Maximum DALL-E generation attempts per concept" },
  { key: "mockups_per_product", value: "10", type: "number" as const, group: "pipeline" as const, description: "Target mockup count per product" },
  { key: "approval_batch_size", value: "5", type: "number" as const, group: "pipeline" as const, description: "Number of listings per approval batch" },
  { key: "approval_mode", value: "manual", type: "string" as const, group: "pipeline" as const, description: "Approval mode: manual or auto" },
  { key: "training_wheels_enabled", value: "true", type: "boolean" as const, group: "pipeline" as const, description: "Block auto-approval until N manual reviews are completed (safety for new shops)" },
  { key: "training_wheels_min_reviews", value: "10", type: "number" as const, group: "pipeline" as const, description: "Manual approvals required before auto-approval activates" },
  { key: "annual_revenue_goal", value: "150000", type: "number" as const, group: "general" as const, description: "Annual revenue target in USD for goal tracking" },
  { key: "target_car_price", value: "0", type: "number" as const, group: "general" as const, description: "Personal goal target (e.g. car price). Tracks total profit progress on the metrics tab. 0 = hidden." },

  // Pricing
  { key: "base_price", value: "25.00", type: "number" as const, group: "pricing" as const, description: "Minimum retail price in USD" },
  { key: "margin_percent", value: "40", type: "number" as const, group: "pricing" as const, description: "Target profit margin percentage" },
  { key: "max_title_length", value: "140", type: "number" as const, group: "pricing" as const, description: "Maximum Etsy listing title length" },
  { key: "max_tags", value: "13", type: "number" as const, group: "pricing" as const, description: "Maximum Etsy tags per listing" },
  { key: "tease_pricing_enabled", value: "false", type: "boolean" as const, group: "pricing" as const, description: "Set one variant at a discount so listings show 'from $X' in search. Picks a plausible but unpopular variant (e.g. cream Youth-Small) — looks like a real option, not obvious bait." },
  { key: "tease_pricing_discount_pct", value: "70", type: "number" as const, group: "pricing" as const, description: "How much to discount the hook variant (0-95%). Higher = cheaper 'from' price. The hook variant is a subtle low-demand combo like sand/XS or cream/Youth-S that rarely gets purchased." },
  { key: "tease_pricing_floor_mode", value: "cost", type: "string" as const, group: "pricing" as const, description: "Floor for the hook price: 'cost' = break even (recommended), 'safe' = cost + 15% margin (zero risk), or 'absolute' = use tease_pricing_absolute_floor as a literal $ value to go even lower than cost." },
  { key: "tease_pricing_absolute_floor", value: "5.99", type: "number" as const, group: "pricing" as const, description: "When floor_mode='absolute', the literal minimum price for the hook variant. Set to $5-7 to hit the 'from $X' sweet spot. If below product cost, that variant loses money per sale — but it's a size/color combo almost nobody orders." },
  { key: "tease_companion_enabled", value: "false", type: "boolean" as const, group: "pricing" as const, description: "Auto-create a cheap 'companion' product (postcard, sticker, magnet) for every design. Each design gets a $5-8 entry-point listing in your shop alongside the main t-shirt/hoodie. Mimics what real Etsy POD shops do to get cheap from-prices showing in search." },
  { key: "tease_companion_product_type", value: "postcard", type: "string" as const, group: "pricing" as const, description: "Which cheap product type to auto-create as the companion. Options: postcard (cheapest, ~$1.50 cost, $5.99 retail), sticker (~$2 cost, $4.99-7.99), greeting_card (~$3 cost, $5.99-9.99), fridge_magnet (~$3.50 cost, $6.99), baby_bodysuit (~$9 cost, $16.99). Postcard recommended as the cheapest possible bait." },
  { key: "tease_companion_retail_price", value: "5.99", type: "number" as const, group: "pricing" as const, description: "Retail price for the companion product. Real shops use $5.99 — high enough for tiny margin on cheap product types, low enough to catch attention in search." },

  // Limits
  { key: "max_daily_cost", value: "30.00", type: "number" as const, group: "limits" as const, description: "Maximum daily spend in USD" },
  { key: "max_daily_listings", value: "25", type: "number" as const, group: "limits" as const, description: "Maximum listings published per day" },
  { key: "max_products_per_design", value: "3", type: "number" as const, group: "limits" as const, description: "Max Printify products created per design concept" },
  { key: "pipeline_runs_per_day", value: "1", type: "number" as const, group: "limits" as const, description: "Pipeline runs per day (1 or 2). Second run at 2 PM UTC." },

  // API
  { key: "dalle_model", value: "dall-e-3", type: "string" as const, group: "api" as const, description: "DALL-E model to use for image generation" },
  { key: "dalle_quality", value: "hd", type: "string" as const, group: "api" as const, description: "DALL-E image quality: hd or standard" },
  { key: "gpt_model", value: "gpt-4.1", type: "string" as const, group: "api" as const, description: "GPT model for text generation" },

  // Seasonal
  { key: "seasonal_boost_enabled", value: "true", type: "boolean" as const, group: "pipeline" as const, description: "Boost seasonal niches during holiday prep windows" },

  // Product types — all 16 available, top 5 enabled by default
  { key: "enabled_product_types", value: '["unisex_tshirt","hoodie","mug_11oz","poster","tote_bag"]', type: "json" as const, group: "pipeline" as const, description: "Product types to create per design (from: unisex_tshirt, hoodie, crewneck_sweatshirt, tank_top, long_sleeve_tee, vneck_tshirt, mug_11oz, mug_15oz, tote_bag, poster, canvas_print, phone_case, sticker, mousepad, blanket, throw_pillow)" },

  // Platforms
  { key: "enabled_platforms", value: '["etsy"]', type: "json" as const, group: "pipeline" as const, description: "Platforms to publish listings to (etsy, shopify, tiktok, depop, redbubble, amazon)" },
];

async function seed() {
  const dbUrl = process.env.TURSO_DATABASE_URL || "file:./neopod.db";
  const client = createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  const db = drizzle(client);

  console.log("Seeding default settings...");

  for (const setting of DEFAULT_SETTINGS) {
    const existing = await db.select().from(settings).where(eq(settings.key, setting.key)).get();
    if (!existing) {
      await db.insert(settings).values({
        ...setting,
        updatedAt: new Date().toISOString(),
      });
      console.log(`  + ${setting.key} = ${setting.value}`);
    } else {
      console.log(`  ~ ${setting.key} already exists, skipping`);
    }
  }

  console.log("Seed complete.");
  process.exit(0);
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
