// Runs one read-only SQL query against the project database and prints the rows.
// Usage: node --no-warnings --env-file-if-exists=.env .claude/skills/query-database/query.mjs "select ..." [--json]
// The connection string comes from DATABASE_URL and is never printed.
import pg from "pg";

const args = process.argv.slice(2);
const json = args.includes("--json");
const sql = args.filter((arg) => arg !== "--json").join(" ").trim();

if (!sql) {
  console.error('Usage: query.mjs "select ..." [--json]');
  process.exit(2);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set. Put it in .env (see .env.example) and run from the project root.");
  process.exit(2);
}

const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
try {
  await client.connect();
  // The transaction is read-only, so a write statement fails instead of changing data.
  await client.query("BEGIN READ ONLY");
  const result = await client.query(sql);
  await client.query("ROLLBACK");
  const rows = result.rows;
  if (json) console.log(JSON.stringify(rows, null, 2));
  else if (rows.length === 0) console.log(`(0 rows${result.command ? `, ${result.command}` : ""})`);
  else console.table(rows);
  console.error(`${rows.length} row(s)`);
} catch (error) {
  console.error(`Query failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
