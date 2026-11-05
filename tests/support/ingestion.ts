import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { claims, ratingClassifications } from "../../src/db/schema";
import type { RatingClassifier } from "../../src/classification/types";
import { type IngestionDeps, runIngestion } from "../../src/pipeline/run";
import { createDataCommonsAdapter } from "../../src/sources/data-commons/adapter";
import { createTestDb } from "./db";
import { FIXTURE_PATH } from "./fixture";
import { type FeedServer, startFeedServer } from "./feed-server";

/** The date the fixture assumes the run happens on. */
export const RUN_NOW = new Date("2026-11-02T09:30:00Z");

/** A classifier that needs no model: it reads the verdict word, so tests stay offline and deterministic. */
export const keywordClassifier: RatingClassifier = {
  async classify(texts) {
    return texts.map((text) => {
      if (/false|fake|பொய்|අසත්‍යයි/i.test(text)) return { category: "false", severity: 1 };
      if (/mislead|missing context/i.test(text)) return { category: "misleading", severity: 0.7 };
      return { category: "unclassifiable", severity: null };
    });
  },
};

export type Harness = Awaited<ReturnType<typeof createHarness>>;

/** A test Postgres (PGlite), a local feed server, and a scratch directory, wired to the real pipeline. */
export async function createHarness(feedBody: Buffer = readFileSync(FIXTURE_PATH), respond?: Parameters<typeof startFeedServer>[1]) {
  const testDb = await createTestDb();
  const server: FeedServer = await startFeedServer(feedBody, respond);
  const tmpDir = await mkdtemp(join(tmpdir(), "ingestion-test-"));

  const ingest = (overrides: Partial<IngestionDeps> = {}) =>
    runIngestion({
      adapter: createDataCommonsAdapter({ allowlist: server.allowlist, tmpDir }),
      classifier: keywordClassifier,
      classifierVersion: "test-v1",
      db: testDb.db,
      allowlist: server.allowlist,
      now: () => RUN_NOW,
      ...overrides,
    });

  return {
    db: testDb.db,
    client: testDb.client,
    server,
    tmpDir,
    ingest,
    /** Empties both tables and forgets the requests the server has seen. */
    async reset() {
      await testDb.db.delete(claims);
      await testDb.db.delete(ratingClassifications);
      server.hits.length = 0;
    },
    async close() {
      await server.close();
      await testDb.close();
      await rm(tmpDir, { recursive: true, force: true });
    },
  };
}
