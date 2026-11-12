import { asc, eq, isNotNull } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claims } from "../src/db/schema";
import { truncateRating } from "../src/classification/service";
import type { RatingClassifier } from "../src/classification/types";
import { type Harness, createHarness, keywordClassifier } from "./support/ingestion";

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

describe("ingestion: rating explanation", () => {
  it("stores the explanation of reviews that carry one, and nothing for the others", async () => {
    await h.ingest();

    const rows = await allClaims();
    const withExplanation = rows.filter((r) => r.ratingExplanation !== null);
    expect(withExplanation.length).toBeGreaterThan(0);
    expect(withExplanation.length).toBeLessThan(rows.length);
    expect(rows.filter((r) => r.publisher === "FACTLY").every((r) => r.ratingExplanation !== null)).toBe(true);
    expect(rows.filter((r) => r.publisher === "Fact Crescendo Sri Lanka").every((r) => r.ratingExplanation === null)).toBe(true);
  });

  it("does not count a review without an explanation as excluded", async () => {
    const report = await h.ingest();
    expect(report.stored + Object.values(report.excluded).reduce((sum, n) => sum + n, 0)).toBe(report.read);
    expect(report).toMatchObject({ stored: 27 });
  });

  it("replaces a stored explanation with the feed's on a re-run, and clears one the feed no longer has", async () => {
    await h.ingest();
    const rows = await allClaims();
    const kept = rows.find((r) => r.ratingExplanation !== null)!;
    const bare = rows.find((r) => r.ratingExplanation === null)!;
    await h.db.update(claims).set({ ratingExplanation: "Old explanation" }).where(eq(claims.id, kept.id));
    await h.db.update(claims).set({ ratingExplanation: "Stale explanation" }).where(eq(claims.id, bare.id));

    await h.ingest();

    const after = await allClaims();
    expect(after.find((r) => r.id === kept.id)!.ratingExplanation).toBe(kept.ratingExplanation);
    expect(after.find((r) => r.id === bare.id)!.ratingExplanation).toBeNull();
  });

  it("is still idempotent: the same snapshot twice stores the same explanations", async () => {
    await h.ingest();
    const first = await allClaims();
    await h.ingest();
    expect(await allClaims()).toEqual(first);
    expect((await h.db.select().from(claims).where(isNotNull(claims.ratingExplanation))).length).toBeGreaterThan(0);
  });

  it("gives the classifier rating texts only, never an explanation", async () => {
    const received: string[][] = [];
    const spy: RatingClassifier = {
      classify: async (ratingTexts) => {
        received.push([...ratingTexts]);
        return keywordClassifier.classify(ratingTexts);
      },
    };

    await h.ingest({ classifier: spy });

    const rows = await allClaims();
    const explanations = rows.flatMap((r) => (r.ratingExplanation === null ? [] : [r.ratingExplanation]));
    const sent = received.flat();
    expect(sent.length).toBeGreaterThan(0);
    expect(explanations.length).toBeGreaterThan(0);
    expect(sent.some((text) => explanations.includes(text))).toBe(false);
    // The classifier service truncates very long rating texts before sending them.
    const ratingTexts = new Set(rows.map((r) => truncateRating(r.ratingText)));
    expect(sent.every((text) => ratingTexts.has(text))).toBe(true);
  });
});

describe("ingestion: an over-long rating explanation", () => {
  let long: Harness;
  const longExplanation = "The claim does not hold up when checked against the record. ".repeat(40);

  beforeAll(async () => {
    const feed = {
      "@type": "DataFeed",
      dataFeedElement: [
        {
          "@type": "DataFeedItem",
          item: [
            {
              "@type": "ClaimReview",
              author: { name: "Example Checker" },
              claimReviewed: "The president announced that all schools in the capital city will close for the whole month of November.",
              datePublished: "2026-10-30",
              url: "https://example.org/check/long",
              reviewRating: { alternateName: "False", ratingExplanation: longExplanation },
            },
          ],
        },
      ],
    };
    long = await createHarness(Buffer.from(JSON.stringify(feed)));
  });

  afterAll(async () => {
    await long.close();
  });

  it("is stored cut to at most 1000 characters, ending in an ellipsis", async () => {
    await long.ingest();

    const [row] = await long.db.select().from(claims);
    expect(longExplanation.length).toBeGreaterThan(1000);
    expect(row!.ratingExplanation!.length).toBeLessThanOrEqual(1000);
    expect(row!.ratingExplanation!.endsWith("…")).toBe(true);
    expect(longExplanation.startsWith(row!.ratingExplanation!.slice(0, -1))).toBe(true);
  });
});
