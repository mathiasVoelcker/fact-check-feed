import { asc } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { allowlist as realAllowlist } from "../src/allowlist/allowlist";
import { SourceNotAllowlistedError } from "../src/allowlist/guard";
import { claims } from "../src/db/schema";
import { createDataCommonsAdapter } from "../src/sources/data-commons/adapter";
import { type Harness, createHarness } from "./support/ingestion";

/** The columns a stored record may have: the permitted feed fields, the derived rating fields, and technical ones. */
const PERMITTED_COLUMNS = [
  "id",
  "url",
  "claim_text",
  "rating_text",
  "publisher",
  "published_on",
  "source_id",
  "category",
  "severity",
  "ingested_at",
].sort();

let h: Harness;
let requestedUrls: string[];
const realFetch = globalThis.fetch;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  requestedUrls = [];
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    requestedUrls.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    return realFetch(input, init);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("legal: only the permitted fields are stored", () => {
  it("has exactly the permitted columns in the claims table", async () => {
    const result = await h.client.query<{ column_name: string }>(
      `select column_name from information_schema.columns where table_schema = 'public' and table_name = 'claims'`,
    );
    expect(result.rows.map((row) => row.column_name).sort()).toEqual(PERMITTED_COLUMNS);
  });

  it("stores no article text and no other feed field in any value", async () => {
    await h.ingest();
    const stored = JSON.stringify(await h.db.select().from(claims));

    for (const feedOnly of ["Google Fact Check Tools", "DataFeedItem", "ClaimReview", "itemReviewed", "sdPublisher", "dateCreated", "appearance"]) {
      expect(stored, feedOnly).not.toContain(feedOnly);
    }
  });
});

describe("legal: the publisher site is never contacted", () => {
  it("requests nothing but the feed itself during a whole run", async () => {
    await h.ingest();

    const feedUrl = h.server.allowlist.get("data-commons-claimreview")!.url;
    expect(requestedUrls).toEqual([feedUrl]);
    expect(new Set(requestedUrls.map((url) => new URL(url).host))).toEqual(new Set([new URL(feedUrl).host]));
    expect(h.server.hits.map((hit) => hit.path)).toEqual(["/data.json"]);
  });

  it("does not request any stored record's own URL", async () => {
    await h.ingest();
    const stored = await h.db.select().from(claims).orderBy(asc(claims.url));
    expect(stored.length).toBeGreaterThan(0);
    for (const row of stored) expect(requestedUrls).not.toContain(row.url);
  });

  it("identifies itself in the request", async () => {
    await h.ingest();
    expect(h.server.hits[0]?.headers["user-agent"]).toMatch(/^fact-check-feed\/\d/);
  });
});

describe("legal: only allowlisted sources are read", () => {
  it("refuses an unlisted source before any request, even if its adapter could fetch", async () => {
    const adapter = { ...createDataCommonsAdapter({ allowlist: h.server.allowlist, tmpDir: h.tmpDir }), sourceId: "unlisted-source" };

    await expect(h.ingest({ adapter })).rejects.toThrow(SourceNotAllowlistedError);
    await expect(h.ingest({ adapter })).rejects.toThrow(/"unlisted-source".*not allowlisted/);

    expect(requestedUrls).toEqual([]);
    expect(h.server.hits).toEqual([]);
    expect(await h.db.select().from(claims)).toEqual([]);
  });
});

describe("legal: attribution travels with the data", () => {
  it("lets a consumer look up the license and attribution text from each stored record's source", async () => {
    await h.ingest();
    const stored = await h.db.select().from(claims);
    expect(stored.length).toBeGreaterThan(0);

    for (const row of stored) {
      const source = realAllowlist.get(row.sourceId);
      expect(source, row.sourceId).toBeDefined();
      expect(source).toMatchObject({ license: "CC BY 4.0", attributionRequired: true });
      expect(source!.attributionText).toContain("Data Commons");
      expect(source!.attributionText.length).toBeGreaterThan(30);
    }
  });

  it("gives every stored record a source reference", async () => {
    await h.ingest();
    const stored = await h.db.select().from(claims);
    expect(stored.every((row) => row.sourceId === "data-commons-claimreview")).toBe(true);
  });
});
