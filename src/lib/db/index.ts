import { drizzle } from "drizzle-orm/libsql";
import { createClient } from "@libsql/client";
import * as schema from "./schema";

function createDb() {
  const dbUrl = process.env.TURSO_DATABASE_URL || "file:./neopod.db";

  const client = createClient({
    url: dbUrl,
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  return drizzle(client, { schema });
}

type DbInstance = ReturnType<typeof createDb>;

// Singleton for serverless — avoid re-creating on every invocation
const globalForDb = globalThis as unknown as { _db: DbInstance | undefined };

// Lazy initialization: only create the DB client when first accessed (not at build time)
export const db: DbInstance = new Proxy({} as DbInstance, {
  get(_target, prop, receiver) {
    if (!globalForDb._db) {
      globalForDb._db = createDb();
    }
    const value = Reflect.get(globalForDb._db, prop, receiver);
    if (typeof value === "function") {
      return value.bind(globalForDb._db);
    }
    return value;
  },
});

export type Database = DbInstance;
