import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { sql } from "drizzle-orm";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { claims } from "../src/db/schema";
import { assertLocalDatabaseUrl } from "./local-database";
import { seedClaims } from "./seed";

const MIGRATIONS_FOLDER = fileURLToPath(new URL("../drizzle", import.meta.url));

/** Runs once before the tests: real migrations, empty tables, the seed (design X4). The tests only read. */
export default async function globalSetup() {
  const pool = new pg.Pool({ connectionString: assertLocalDatabaseUrl(process.env.E2E_DATABASE_URL) });
  try {
    const db = drizzle(pool);
    await migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
    await db.execute(sql`TRUNCATE claims, rating_classifications RESTART IDENTITY`);
    await db.insert(claims).values(seedClaims());
  } finally {
    await pool.end();
  }
}
