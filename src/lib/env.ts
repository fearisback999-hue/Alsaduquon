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
