import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { fileURLToPath } from "node:url";
import * as schema from "../../src/db/schema";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../../drizzle", import.meta.url));

/** A fresh in-process Postgres (PGlite) with every migration applied. Call `close()` when done. */
export async function createTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  return { db, client, close: () => client.close() };
}

/** The same Postgres, with no migration applied, for tests that apply migrations themselves. */
export function createEmptyTestDb() {
  const client = new PGlite();
  const db = drizzle(client, { schema });
  return { db, client, migrationsFolder: MIGRATIONS_FOLDER, close: () => client.close() };
}
