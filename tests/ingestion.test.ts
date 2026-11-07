import { readdir } from "node:fs/promises";
import { asc, eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claims, ratingClassifications } from "../src/db/schema";
import { type Harness, createHarness } from "./support/ingestion";

let h: Harness;

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
});

const allClaims = () => h.db.select().from(claims).orderBy(asc(claims.url));

const seed = (overrides: Partial<typeof claims.$inferInsert> & { url: string }) =>
  h.db
    .insert(claims)
    .values({
      claimText: "Old claim",
      ratingText: "Old rating",
      publisher: "Old publisher",
      publishedOn: "2026-10-01",
      sourceId: "data-commons-claimreview",
      category: "mixed",
      severity: 0.4,
      ...overrides,
    })
    .returning();

describe("ingestion: a successful run", () => {
  it("stores the qualifying records from the fixture", async () => {
    await h.ingest();

    const rows = await allClaims();
    expect(rows).toHaveLength(27);
    expect(rows.every((r) => r.sourceId === "data-commons-claimreview")).toBe(true);
    expect(rows.every((r) => r.publishedOn >= "2026-08-04" && r.publishedOn <= "2026-11-02")).toBe(true);

    const sample = rows.find((r) => r.claimText.startsWith("A man seen standing beside the President"));
    expect(sample).toMatchObject({
      ratingText: "False",
      publisher: "Fact Crescendo Sri Lanka",
      publishedOn: "2026-10-30",
      category: "false",
      severity: 1,
    });
  });

  it("stores unclassifiable records without a severity", async () => {
    await h.ingest();
    const rows = await allClaims();
    const unclassifiable = rows.filter((r) => r.category === "unclassifiable");
    expect(unclassifiable.length).toBeGreaterThan(0);
    expect(unclassifiable.every((r) => r.severity === null)).toBe(true);
    expect(rows.filter((r) => r.category !== "unclassifiable").every((r) => r.severity !== null)).toBe(true);
  });

  it("reports what it read, stored and excluded per reason", async () => {
    const report = await h.ingest();

    expect(report).toMatchObject({ sourceId: "data-commons-claimreview", runDate: "2026-11-02", read: 54, stored: 27, removed: 0 });
    expect(report.excluded).toMatchObject({
      malformed: 1,
      "missing-claim-text": 1,
      "missing-url": 1,
      "missing-publisher": 1,
      "missing-rating-text": 0,
      "invalid-date": 6,
      "future-date": 2,
      "outside-window": 4,
      "duplicate-url": 2,
    });
    expect(report.excluded["non-english"]).toBeGreaterThanOrEqual(9);
    const excluded = Object.values(report.excluded).reduce((sum, n) => sum + n, 0);
    expect(report.stored + excluded).toBe(report.read);
    expect(report.classification).toMatchObject({ failed: 0 });
    expect(report.classification.distinct).toBeGreaterThan(0);
  });

  it("caches the classifications it made", async () => {
    await h.ingest();
    const cached = await h.db.select().from(ratingClassifications);
    expect(cached.length).toBeGreaterThan(0);
    expect(cached.every((c) => c.classifierVersion === "test-v1")).toBe(true);
  });

  it("deletes the downloaded snapshot when it is done", async () => {
    await h.ingest();
    expect(await readdir(h.tmpDir)).toEqual([]);
  });
});

describe("ingestion: repeating and updating", () => {
  it("is idempotent: running the same snapshot again changes nothing", async () => {
    await h.ingest();
    const first = await allClaims();

    const report = await h.ingest();
    const second = await allClaims();

    expect(second).toEqual(first);
    expect(report).toMatchObject({ stored: 27, removed: 0 });
  });

  it("creates a record for a URL that is not stored yet, and leaves the other stored records alone", async () => {
    const url = "https://srilanka.factcrescendo.com/english/buddhasasana-minister-catholic-ruwanweliseya-monument-claim-false/";
    const [other] = await seed({ url: "https://example.org/already-here", publishedOn: "2026-10-20" });
    expect(await h.db.select().from(claims).where(eq(claims.url, url))).toEqual([]);

    await h.ingest();

    const created = await h.db.select().from(claims).where(eq(claims.url, url));
    expect(created).toHaveLength(1);
    expect(created[0]!.id).not.toBe(other!.id);
    expect(await h.db.select().from(claims).where(eq(claims.url, "https://example.org/already-here"))).toEqual([other]);
  });

  it("updates a stored URL in place instead of adding a second record", async () => {
    const url = "https://srilanka.factcrescendo.com/english/buddhasasana-minister-catholic-ruwanweliseya-monument-claim-false/";
    const [seeded] = await seed({ url, ratingText: "Mostly true", category: "true", severity: 0, publishedOn: "2026-10-30" });

    await h.ingest();

    const rows = await h.db.select().from(claims).where(eq(claims.url, url));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: seeded!.id, ratingText: "False", category: "false", severity: 1 });
    expect(rows[0]!.claimText).toContain("belittled");
    expect(rows[0]!.ingestedAt).toEqual(seeded!.ingestedAt);
  });

  it("leaves stored records that are not in the snapshot but are still inside the window", async () => {
    await seed({ url: "https://example.org/older-but-recent", publishedOn: "2026-10-01" });
    await h.ingest();
    expect((await allClaims()).some((r) => r.url === "https://example.org/older-but-recent")).toBe(true);
  });
});

describe("ingestion: the 90-day window", () => {
  it("removes stored records that have aged out, and keeps day 90", async () => {
    await seed({ url: "https://example.org/day-91", publishedOn: "2026-08-03" });
    await seed({ url: "https://example.org/day-90", publishedOn: "2026-08-04" });
    await seed({ url: "https://example.org/long-gone", publishedOn: "2026-01-15" });

    const report = await h.ingest();

    const urls = (await allClaims()).map((r) => r.url);
    expect(urls).toContain("https://example.org/day-90");
    expect(urls).not.toContain("https://example.org/day-91");
    expect(urls).not.toContain("https://example.org/long-gone");
    expect(report.removed).toBe(2);
  });
});

describe("ingestion: failures leave the data unchanged", () => {
  it("rolls everything back when storing fails partway through", async () => {
    // A NUL character cannot be stored in Postgres text, so the second batch of inserts fails after the first succeeded.
    const review = (n: number, claim: string) => ({
      "@type": "ClaimReview",
      author: { name: `Publisher ${n}` },
      claimReviewed: claim,
      datePublished: "2026-10-30",
      reviewRating: { alternateName: "False" },
      url: `https://example.org/check/${n}`,
    });
    const feed = Buffer.from(
      JSON.stringify({
        dataFeedElement: [
          { item: [review(1, "The video shows a crowd gathering in the city centre on Friday evening.")] },
          { item: [review(2, "The photo shows the minister visiting a hospital in the northern province.")] },
          { item: [review(3, "The report says the government has banned the import of all vehicles this year.")] },
          { item: [review(4, "The video shows a bridge collapsing in the capital during\u0000 the heavy rains.")] },
        ],
      }),
    );
    const failing = await createHarness(feed);
    try {
      const [stale] = await failing.db
        .insert(claims)
        .values({ url: "https://example.org/stale", claimText: "Stale", ratingText: "False", publisher: "P", publishedOn: "2026-06-01", sourceId: "data-commons-claimreview", category: "false", severity: 1 })
        .returning();
      const [existing] = await failing.db
        .insert(claims)
        .values({ url: "https://example.org/check/1", claimText: "Before", ratingText: "True", publisher: "P", publishedOn: "2026-10-30", sourceId: "data-commons-claimreview", category: "true", severity: 0 })
        .returning();
      const before = await failing.db.select().from(claims).orderBy(asc(claims.url));

      await expect(failing.ingest({ upsertChunkSize: 2 })).rejects.toThrow();

      const after = await failing.db.select().from(claims).orderBy(asc(claims.url));
      expect(after).toEqual(before);
      expect(after.map((r) => r.id).sort()).toEqual([stale!.id, existing!.id].sort());
      expect(after.find((r) => r.url === "https://example.org/check/1")?.claimText).toBe("Before");
      expect(await readdir(failing.tmpDir)).toEqual([]);
    } finally {
      await failing.close();
    }
  });

  it("changes nothing when the download fails", async () => {
    await seed({ url: "https://example.org/kept", publishedOn: "2026-10-20" });
    await seed({ url: "https://example.org/would-age-out", publishedOn: "2026-01-01" });
    const before = await allClaims();

    const broken = await createHarness(Buffer.from("{}"), () => ({ status: 500, body: "boom" }));
    try {
      await broken.db.insert(claims).values(before.map(({ id: _id, ...rest }) => rest));
      await expect(broken.ingest()).rejects.toThrow(/500/);
      expect((await broken.db.select().from(claims).orderBy(asc(claims.url))).map(({ id: _id, ...rest }) => rest)).toEqual(
        before.map(({ id: _id, ...rest }) => rest),
      );
      expect(await readdir(broken.tmpDir)).toEqual([]);
    } finally {
      await broken.close();
    }
  });

  it("changes nothing when the content is not a feed", async () => {
    await seed({ url: "https://example.org/kept", publishedOn: "2026-10-20" });
    const before = await allClaims();

    await expect(
      (async () => {
        const notAFeed = await createHarness(Buffer.from('{"hello":"world"}'));
        try {
          await notAFeed.db.insert(claims).values(before.map(({ id: _id, ...rest }) => rest));
          await expect(notAFeed.ingest()).rejects.toThrow(/feed/i);
          expect((await notAFeed.db.select().from(claims)).map(({ id: _id, ...rest }) => rest)).toEqual(before.map(({ id: _id, ...rest }) => rest));
        } finally {
          await notAFeed.close();
        }
      })(),
    ).resolves.toBeUndefined();
  });

  it("fails the run, and keeps old rows, when the feed has entries but no reviews (changed structure)", async () => {
    await seed({ url: "https://example.org/kept", publishedOn: "2026-10-20" });
    await seed({ url: "https://example.org/would-age-out", publishedOn: "2026-01-01" });
    const before = await allClaims();

    const renamed = await createHarness(Buffer.from(JSON.stringify({ dataFeedElement: [{ itemRenamed: [{ claimReviewed: "x" }] }, { itemRenamed: [] }] })));
    try {
      await renamed.db.insert(claims).values(before.map(({ id: _id, ...rest }) => rest));
      await expect(renamed.ingest()).rejects.toThrow(/no reviews/i);
      expect((await renamed.db.select().from(claims).orderBy(asc(claims.url))).map(({ id: _id, ...rest }) => rest)).toEqual(
        before.map(({ id: _id, ...rest }) => rest),
      );
      expect(await readdir(renamed.tmpDir)).toEqual([]);
    } finally {
      await renamed.close();
    }
  });
});
