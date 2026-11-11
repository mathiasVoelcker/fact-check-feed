import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createEmptyTestDb, createTestDb } from "./support/db";

type Db = Awaited<ReturnType<typeof createTestDb>>;
let testDb: Db;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

async function columnsOf(table: string): Promise<string[]> {
  const result = await testDb.client.query<{ column_name: string }>(
    `select column_name from information_schema.columns where table_schema = 'public' and table_name = $1 order by column_name`,
    [table],
  );
  return result.rows.map((row) => row.column_name);
}

async function constraintsOf(table: string, type: "PRIMARY KEY" | "UNIQUE"): Promise<string[][]> {
  const result = await testDb.client.query<{ columns: string[] }>(
    `select array_agg(kcu.column_name::text order by kcu.ordinal_position) as columns
       from information_schema.table_constraints tc
       join information_schema.key_column_usage kcu
         on kcu.constraint_name = tc.constraint_name and kcu.table_schema = tc.table_schema
      where tc.table_schema = 'public' and tc.table_name = $1 and tc.constraint_type = $2
      group by tc.constraint_name`,
    [table, type],
  );
  return result.rows.map((row) => row.columns);
}

const claim = (overrides: Record<string, unknown> = {}) => ({
  url: "https://example.org/a",
  claim_text: "A claim",
  rating_text: "False",
  publisher: "Example",
  published_on: "2026-10-30",
  source_id: "data-commons-claimreview",
  category: "false",
  severity: 1,
  ...overrides,
});

async function insertClaim(values: ReturnType<typeof claim>) {
  const keys = Object.keys(values);
  const placeholders = keys.map((_, i) => `$${i + 1}`).join(", ");
  return testDb.client.query(
    `insert into claims (${keys.join(", ")}) values (${placeholders})`,
    keys.map((key) => (values as Record<string, unknown>)[key]),
  );
}

describe("claims table", () => {
  it("has exactly the permitted feed columns plus the technical id, and no others", async () => {
    expect(await columnsOf("claims")).toEqual(
      [
        "id",
        "url",
        "claim_text",
        "rating_text",
        "rating_explanation",
        "publisher",
        "published_on",
        "source_id",
        "category",
        "severity",
        "ingested_at",
      ].sort(),
    );
  });

  it("uses the surrogate id as primary key and keeps url unique", async () => {
    expect(await constraintsOf("claims", "PRIMARY KEY")).toEqual([["id"]]);
    expect(await constraintsOf("claims", "UNIQUE")).toEqual([["url"]]);
  });

  it("rejects a second record with the same url", async () => {
    await insertClaim(claim({ url: "https://example.org/dup" }));
    await expect(insertClaim(claim({ url: "https://example.org/dup", claim_text: "Other" }))).rejects.toThrow(
      /unique|duplicate/i,
    );
  });

  it("allows a missing severity", async () => {
    await expect(
      insertClaim(claim({ url: "https://example.org/unclassifiable", category: "unclassifiable", severity: null })),
    ).resolves.toBeDefined();
  });

  it("allows a record without a rating explanation, which is then null", async () => {
    await insertClaim(claim({ url: "https://example.org/no-explanation" }));
    await insertClaim(claim({ url: "https://example.org/with-explanation", rating_explanation: "Because." }));
    const result = await testDb.client.query<{ url: string; rating_explanation: string | null }>(
      `select url, rating_explanation from claims where url like 'https://example.org/%explanation' order by url`,
    );
    expect(result.rows).toEqual([
      { url: "https://example.org/no-explanation", rating_explanation: null },
      { url: "https://example.org/with-explanation", rating_explanation: "Because." },
    ]);
  });

  it("rejects a category outside the fixed set", async () => {
    await expect(insertClaim(claim({ url: "https://example.org/bad", category: "maybe" }))).rejects.toThrow();
  });

  it("assigns ids automatically", async () => {
    const result = await testDb.client.query<{ id: number }>(`select id from claims order by id`);
    expect(result.rows.length).toBeGreaterThan(0);
    expect(new Set(result.rows.map((row) => row.id)).size).toBe(result.rows.length);
  });
});

describe("rating_classifications table", () => {
  it("has its columns and an id", async () => {
    expect(await columnsOf("rating_classifications")).toEqual(
      ["id", "rating_text", "category", "severity", "classified_at", "classifier_version"].sort(),
    );
  });

  it("uses the surrogate id as primary key and keeps rating_text unique", async () => {
    expect(await constraintsOf("rating_classifications", "PRIMARY KEY")).toEqual([["id"]]);
    expect(await constraintsOf("rating_classifications", "UNIQUE")).toEqual([["rating_text"]]);
  });

  it("rejects a second classification for the same rating text", async () => {
    const insert = () =>
      testDb.client.query(
        `insert into rating_classifications (rating_text, category, severity, classifier_version) values ($1, $2, $3, $4)`,
        ["False", "false", 1, "v1"],
      );
    await insert();
    await expect(insert()).rejects.toThrow(/unique|duplicate/i);
  });
});

describe("migrations", () => {
  it("apply to an empty database", async () => {
    const empty = createEmptyTestDb();
    const { migrate } = await import("drizzle-orm/pglite/migrator");
    await expect(migrate(empty.db, { migrationsFolder: empty.migrationsFolder })).resolves.toBeUndefined();
    const tables = await empty.client.query<{ table_name: string }>(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    expect(tables.rows.map((row) => row.table_name)).toEqual(
      expect.arrayContaining(["claims", "rating_classifications"]),
    );
    await empty.close();
  });
});
