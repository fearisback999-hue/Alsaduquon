import { z } from "zod";

const baseSchema = z.object({
  OPENAI_API_KEY: z.string().min(1),
  ADMIN_PASSWORD: z.string().min(1),
});

const productionSchema = baseSchema.extend({
  TURSO_DATABASE_URL: z.string().min(1),
  TURSO_AUTH_TOKEN: z.string().min(1),
  PRINTIFY_API_TOKEN: z.string().min(1),
  PRINTIFY_SHOP_ID: z.string().min(1),
  ETSY_CLIENT_ID: z.string().min(1),
  ETSY_CLIENT_SECRET: z.string().min(1),
  ETSY_REFRESH_TOKEN: z.string().min(1),
  BLOB_READ_WRITE_TOKEN: z.string().min(1),
  CRON_SECRET: z.string().min(1),
});

export function validateEnv(): { valid: boolean; missing: string[] } {
  if (process.env.SKIP_ENV_VALIDATION === "1") {
    return { valid: true, missing: [] };
  }

  const isProd = process.env.NODE_ENV === "production";
  const schema = isProd ? productionSchema : baseSchema;
  const parsed = schema.safeParse(process.env);

  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => i.path.join("."));
    return { valid: false, missing };
  }
  return { valid: true, missing: [] };
}
