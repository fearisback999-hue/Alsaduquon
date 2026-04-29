import { z } from "zod";

const envSchema = z.object({
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().optional(),
  OPENAI_API_KEY: z.string().min(1),
  PRINTIFY_API_TOKEN: z.string().min(1),
  PRINTIFY_SHOP_ID: z.string().min(1),
  ETSY_CLIENT_ID: z.string().min(1),
  ETSY_CLIENT_SECRET: z.string().min(1),
  ETSY_REFRESH_TOKEN: z.string().min(1),
  ETSY_SHOP_ID: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
  CRON_SECRET: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().optional(),
  PODCS_API_KEY: z.string().optional(),
  FLYING_RESEARCH_API_KEY: z.string().optional(),

  // Shopify
  SHOPIFY_STORE_URL: z.string().optional(),
  SHOPIFY_ACCESS_TOKEN: z.string().optional(),

  // TikTok Shop
  TIKTOK_SHOP_APP_KEY: z.string().optional(),
  TIKTOK_SHOP_APP_SECRET: z.string().optional(),
  TIKTOK_SHOP_ACCESS_TOKEN: z.string().optional(),

  // Depop
  DEPOP_CLIENT_ID: z.string().optional(),
  DEPOP_CLIENT_SECRET: z.string().optional(),
  DEPOP_ACCESS_TOKEN: z.string().optional(),

  // Redbubble
  REDBUBBLE_API_KEY: z.string().optional(),
  REDBUBBLE_ACCOUNT_ID: z.string().optional(),

  // Amazon SP-API
  AMAZON_SELLER_ID: z.string().optional(),
  AMAZON_MWS_ACCESS_KEY: z.string().optional(),
  AMAZON_MWS_SECRET_KEY: z.string().optional(),
  AMAZON_REFRESH_TOKEN: z.string().optional(),
  AMAZON_MARKETPLACE_ID: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

let _env: Env | null = null;

export function getEnv(): Env {
  if (_env) return _env;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join(".")).join(", ");
    throw new Error(`Missing required environment variables: ${missing}`);
  }
  _env = parsed.data;
  return _env;
}
