import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";
import type { Database } from "./types";

const globalForDb = globalThis as unknown as { feedDb?: Database };

/**
 * The database the web app reads (server side only: `DATABASE_URL` never reaches the browser). One pool is shared by every
 * request in the server process; the global keeps it across hot reloads in development.
 */
export function getDb(): Database {
  if (!globalForDb.feedDb) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) throw new Error("DATABASE_URL is not set. Put it in .env or .env.local (see .env.example) or the environment.");
    globalForDb.feedDb = drizzle(new pg.Pool({ connectionString }), { schema });
  }
  return globalForDb.feedDb;
}
