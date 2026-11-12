import { asc, eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { truncateRating } from "../src/classification/service";
import type { RatingClassifier } from "../src/classification/types";
import { claims } from "../src/db/schema";
import { type Harness, createHarness, keywordClassifier } from "./support/ingestion";

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

const allClaims = () => h.db.select().from(claims).orderBy(asc(claims.url));

describe("ingestion: claim origin", () => {
  it("stores the origin of reviews that carry it, and nothing for the others", async () => {
    await h.ingest();

    const rows = await allClaims();
    const withUrl = rows.filter((r) => r.originalUrl !== null);
    expect(withUrl.length).toBeGreaterThan(0);
    expect(withUrl.length).toBeLessThan(rows.length);
    expect(withUrl.every((r) => /^https?:\/\//.test(r.originalUrl!))).toBe(true);
    expect(rows.filter((r) => r.publisher === "FACTLY").every((r) => r.originalUrl !== null)).toBe(true);

    const sample = rows.find((r) => r.claimText.startsWith("A man seen standing beside the President"));
    expect(sample?.originalUrl).toMatch(/facebook\.com/);
    expect(sample?.originalAuthor).toBe("Social media users");
  });

  it("does not count a review without any origin as excluded", async () => {
    const report = await h.ingest();
    expect(report.stored + Object.values(report.excluded).reduce((sum, n) => sum + n, 0)).toBe(report.read);
    expect(report).toMatchObject({ stored: 27 });
  });

  it("replaces stored origin values with the feed's on a re-run, and clears the ones the feed no longer has", async () => {
    await h.ingest();
    const rows = await allClaims();
    const kept = rows.find((r) => r.originalUrl !== null && r.originalAuthor !== null)!;
    // A review whose feed entry has no appearance URL and no venue: stale values for both must be cleared.
    const bare = rows.find((r) => r.originalUrl === null && r.originalVenue === null)!;
    await h.db
      .update(claims)
      .set({ originalUrl: "https://old.example/1", originalVenue: "Old venue", originalAuthor: "Old author" })
      .where(eq(claims.id, kept.id));
    await h.db
      .update(claims)
      .set({ originalUrl: "https://stale.example/1", originalVenue: "Stale venue", originalAuthor: "Stale author" })
      .where(eq(claims.id, bare.id));

    await h.ingest();

    const after = await allClaims();
    const restored = after.find((r) => r.id === kept.id)!;
    expect([restored.originalUrl, restored.originalVenue, restored.originalAuthor]).toEqual([kept.originalUrl, kept.originalVenue, kept.originalAuthor]);
    const cleared = after.find((r) => r.id === bare.id)!;
    expect([cleared.originalUrl, cleared.originalVenue, cleared.originalAuthor]).toEqual([null, null, bare.originalAuthor]);
  });

  it("is still idempotent: the same snapshot twice stores the same origin values", async () => {
    await h.ingest();
    const first = await allClaims();
    await h.ingest();
    expect(await allClaims()).toEqual(first);
  });

  it("requests no host but the feed's, and none of the stored original URLs", async () => {
    await h.ingest();

    const rows = await allClaims();
    const origins = rows.flatMap((r) => (r.originalUrl === null ? [] : [r.originalUrl]));
    expect(origins.length).toBeGreaterThan(0);
    const feedUrl = h.server.allowlist.get("data-commons-claimreview")!.url;
    expect(requestedUrls).toEqual([feedUrl]);
    for (const origin of origins) expect(requestedUrls).not.toContain(origin);
    expect(new Set(requestedUrls.map((url) => new URL(url).host))).toEqual(new Set([new URL(feedUrl).host]));
  });

  it("gives the classifier rating texts only, never an origin value", async () => {
    const received: string[][] = [];
    const spy: RatingClassifier = {
      classify: async (ratingTexts) => {
        received.push([...ratingTexts]);
        return keywordClassifier.classify(ratingTexts);
      },
    };

    await h.ingest({ classifier: spy });

    const rows = await allClaims();
    const origin = new Set(rows.flatMap((r) => [r.originalUrl, r.originalVenue, r.originalAuthor].filter((v): v is string => v !== null)));
    const sent = received.flat();
    expect(sent.length).toBeGreaterThan(0);
    expect(origin.size).toBeGreaterThan(0);
    expect(sent.some((text) => origin.has(text))).toBe(false);
    const ratingTexts = new Set(rows.map((r) => truncateRating(r.ratingText)));
    expect(sent.every((text) => ratingTexts.has(text))).toBe(true);
  });
});

describe("ingestion: claim origin edge cases", () => {
  let custom: Harness;
  const longVenue = "In a long running series of posts ".repeat(20);
  const longAuthor = "A very long list of authors ".repeat(20);

  const item = (n: number, itemReviewed: unknown) => ({
    "@type": "ClaimReview",
    author: { name: "Example Checker" },
    claimReviewed: `The president announced that all schools in the capital city will close for the whole month of November, claim number ${n}.`,
    datePublished: "2026-10-30",
    url: `https://example.org/check/${n}`,
    reviewRating: { alternateName: "False" },
    itemReviewed,
  });

  beforeAll(async () => {
    const feed = {
      "@type": "DataFeed",
      dataFeedElement: [
        {
          "@type": "DataFeedItem",
          item: [
            item(1, { name: longVenue, author: { name: longAuthor }, appearance: [{ url: "https://www.facebook.com/a/posts/1" }] }),
            item(2, { appearance: [{ url: "javascript:alert(1)" }] }),
            item(3, { firstAppearance: { url: "https://x.com/someone/status/3" }, appearance: [{ url: "https://www.facebook.com/b/posts/4" }] }),
          ],
        },
      ],
    };
    custom = await createHarness(Buffer.from(JSON.stringify(feed)));
  });

  afterAll(async () => {
    await custom.close();
  });

  it("stores a long venue and author cut to at most 200 characters, ending in an ellipsis", async () => {
    await custom.ingest();

    const [row] = await custom.db.select().from(claims).where(eq(claims.url, "https://example.org/check/1"));
    for (const [stored, original] of [[row!.originalVenue!, longVenue], [row!.originalAuthor!, longAuthor]] as const) {
      expect(original.length).toBeGreaterThan(200);
      expect(stored.length).toBeLessThanOrEqual(200);
      expect(stored.endsWith("…")).toBe(true);
      expect(original.startsWith(stored.slice(0, -1))).toBe(true);
    }
  });

  it("stores no original URL for an unsafe one, and does not exclude the review", async () => {
    const report = await custom.ingest();

    const [row] = await custom.db.select().from(claims).where(eq(claims.url, "https://example.org/check/2"));
    expect(row).toBeDefined();
    expect(row!.originalUrl).toBeNull();
    expect(report.stored).toBe(3);
  });

  it("prefers the first appearance over the listed ones", async () => {
    await custom.ingest();

    const [row] = await custom.db.select().from(claims).where(eq(claims.url, "https://example.org/check/3"));
    expect(row!.originalUrl).toBe("https://x.com/someone/status/3");
  });
});
