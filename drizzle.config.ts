import type { Config } from "drizzle-kit";
import { config } from "dotenv";

// Load .env.local (falling back to .env) so `npm run db:push` / `db:migrate`
// work directly without needing dotenv-cli.
config({ path: ".env.local" });
config({ path: ".env" });

export default {
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
