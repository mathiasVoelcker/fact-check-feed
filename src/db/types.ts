import type { PgDatabase } from "drizzle-orm/pg-core";
import type * as schema from "./schema";

/**
 * Any Drizzle Postgres database over this schema. The query-result type differs between drivers
 * (PGlite in tests, node-postgres in production), so it is left open.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Database = PgDatabase<any, typeof schema>;
