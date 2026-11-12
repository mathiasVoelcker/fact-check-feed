import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataCommonsAdapter } from "../src/sources/data-commons/adapter";
import type { ParsedEntry, RawReview } from "../src/sources/types";
import { FIXTURE_PATH, loadFixtureItems } from "./support/fixture";

async function collect(path: string): Promise<ParsedEntry[]> {
  const entries: ParsedEntry[] = [];
  for await (const entry of dataCommonsAdapter.parse(path)) entries.push(entry);
  return entries;
}

function reviewsOf(entries: ParsedEntry[]): RawReview[] {
  return entries.flatMap((entry) => (entry.kind === "review" ? [entry.review] : []));
}

let workDir: string;

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "adapter-test-"));
});

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

async function writeFeed(name: string, items: unknown[]): Promise<string> {
  const path = join(workDir, name);
  await writeFile(path, JSON.stringify({ "@type": "DataFeed", dataFeedElement: [{ "@type": "DataFeedItem", item: items }] }));
  return path;
}

describe("Data Commons adapter: identity", () => {
  it("identifies itself with the allowlisted source id", () => {
    expect(dataCommonsAdapter.sourceId).toBe("data-commons-claimreview");
  });
});

describe("Data Commons adapter: mapping the fixture", () => {
  it("yields one entry per item in the feed, and one malformed entry for the non-review", async () => {
    const entries = await collect(FIXTURE_PATH);
    expect(entries).toHaveLength(loadFixtureItems().length);
    expect(entries.filter((entry) => entry.kind === "malformed")).toHaveLength(1);
  });

  it("maps claim text, rating text, publisher, date string and URL", async () => {
    const reviews = reviewsOf(await collect(FIXTURE_PATH));
    const first = reviews.find((r) => r.url?.includes("hiniduma") || r.claimText?.startsWith("A man seen standing beside the President"));
    expect(first).toBeDefined();
    expect(first).toMatchObject({
      claimText: expect.stringMatching(/^A man seen standing beside the President/),
      ratingText: "False",
      publisher: "Fact Crescendo Sri Lanka",
      publishedDate: "2026-10-30",
      url: expect.stringMatching(/^https:\/\//),
    });
  });

  it("returns exactly the five neutral fields plus the optional explanation and claim origin, and nothing else", async () => {
    const reviews = reviewsOf(await collect(FIXTURE_PATH));
    for (const review of reviews) {
      const allowed = ["claimText", "ratingText", "publisher", "publishedDate", "url", "ratingExplanation", "originalUrl", "originalVenue", "originalAuthor"];
      expect(Object.keys(review).every((key) => allowed.includes(key))).toBe(true);
    }
  });

  it("keeps bilingual and sentence rating texts unchanged", async () => {
    const reviews = reviewsOf(await collect(FIXTURE_PATH));
    expect(reviews.some((r) => r.ratingText === "பொய் / False")).toBe(true);
    expect(reviews.some((r) => (r.ratingText?.length ?? 0) > 80)).toBe(true);
  });

  it("passes invalid and missing date strings through for the pipeline to judge", async () => {
    const reviews = reviewsOf(await collect(FIXTURE_PATH));
    expect(reviews.some((r) => r.publishedDate === "20204-08-02")).toBe(true);
    expect(reviews.some((r) => r.publishedDate === undefined)).toBe(true);
  });
});

describe("Data Commons adapter: rating explanation", () => {
  const feedItem = (reviewRating: Record<string, unknown>) => ({
    "@type": "ClaimReview",
    author: { name: "Example Checker" },
    claimReviewed: "A claim",
    datePublished: "2026-10-30",
    url: "https://example.org/check/1",
    reviewRating: { alternateName: "False", ...reviewRating },
  });

  it("maps reviewRating.ratingExplanation, exactly as written", async () => {
    const path = await writeFeed("explanation.json", [feedItem({ ratingExplanation: "  Global indices show otherwise.\nSee the table. " })]);
    expect(reviewsOf(await collect(path))).toMatchObject([{ ratingExplanation: "  Global indices show otherwise.\nSee the table. " }]);
  });

  it("maps no explanation when it is missing, blank or not a string", async () => {
    const path = await writeFeed("no-explanation.json", [
      feedItem({}),
      feedItem({ ratingExplanation: "   " }),
      feedItem({ ratingExplanation: 42 }),
    ]);
    for (const review of reviewsOf(await collect(path))) expect(review).not.toHaveProperty("ratingExplanation");
  });

  it("finds the explanation on the fixture reviews that carry one, and leaves the others without it", async () => {
    const reviews = reviewsOf(await collect(FIXTURE_PATH));
    expect(reviews.filter((r) => r.ratingExplanation !== undefined)).toHaveLength(14);
    expect(reviews.filter((r) => r.publisher === "Fact Crescendo Sri Lanka").every((r) => r.ratingExplanation === undefined)).toBe(true);
  });
});

describe("Data Commons adapter: claim origin", () => {
  const feedItem = (itemReviewed: unknown) => ({
    "@type": "ClaimReview",
    author: { name: "Example Checker" },
    claimReviewed: "A claim",
    datePublished: "2026-10-30",
    url: "https://example.org/check/1",
    reviewRating: { alternateName: "False" },
    ...(itemReviewed === undefined ? {} : { itemReviewed }),
  });

  it("prefers the first appearance URL over the listed appearances", async () => {
    const path = await writeFeed("first-appearance.json", [
      feedItem({
        "@type": "Claim",
        firstAppearance: { url: "https://x.com/someone/status/1" },
        appearance: [{ url: "https://www.facebook.com/a/posts/2" }, { url: "https://www.facebook.com/b/posts/3" }],
      }),
    ]);
    expect(reviewsOf(await collect(path))).toMatchObject([{ originalUrl: "https://x.com/someone/status/1" }]);
  });

  it("falls back to the first listed appearance, whether appearance is a list or a single object", async () => {
    const path = await writeFeed("appearance.json", [
      feedItem({ appearance: [{ url: "https://www.facebook.com/a/posts/2" }, { url: "https://www.facebook.com/b/posts/3" }] }),
      feedItem({ appearance: { url: "https://www.instagram.com/p/abc/" } }),
    ]);
    expect(reviewsOf(await collect(path))).toMatchObject([
      { originalUrl: "https://www.facebook.com/a/posts/2" },
      { originalUrl: "https://www.instagram.com/p/abc/" },
    ]);
  });

  it("maps the venue and the author name of itemReviewed, exactly as written", async () => {
    const path = await writeFeed("venue-author.json", [feedItem({ name: "In a Facebook post", author: { "@type": "Person", name: "Social media users" } })]);
    expect(reviewsOf(await collect(path))).toMatchObject([{ originalVenue: "In a Facebook post", originalAuthor: "Social media users" }]);
  });

  it("maps nothing when itemReviewed or its parts are missing, blank or not strings", async () => {
    const path = await writeFeed("no-origin.json", [
      feedItem(undefined),
      feedItem("not an object"),
      feedItem({ name: "  ", author: { name: "" }, appearance: [{ url: "  " }, {}], firstAppearance: { url: 5 } }),
      feedItem({ author: "just a string", appearance: "https://example.org/x" }),
    ]);
    for (const review of reviewsOf(await collect(path))) {
      expect(review).not.toHaveProperty("originalUrl");
      expect(review).not.toHaveProperty("originalVenue");
      expect(review).not.toHaveProperty("originalAuthor");
    }
  });

  it("passes a URL that is not http(s) through for the pipeline to judge", async () => {
    const path = await writeFeed("odd-url.json", [feedItem({ appearance: [{ url: "javascript:alert(1)" }] })]);
    expect(reviewsOf(await collect(path))).toMatchObject([{ originalUrl: "javascript:alert(1)" }]);
  });

  it("finds the origin on the fixture reviews that carry it", async () => {
    const reviews = reviewsOf(await collect(FIXTURE_PATH));
    expect(reviews.filter((r) => r.originalUrl !== undefined)).toHaveLength(41);
    expect(reviews.filter((r) => r.originalVenue !== undefined)).toHaveLength(4);
    expect(reviews.filter((r) => r.originalAuthor !== undefined)).toHaveLength(48);
  });
});

describe("Data Commons adapter: ignored feed fields", () => {
  it("ignores the review body, images, further appearance links and other extra fields", async () => {
    const path = await writeFeed("extras.json", [
      {
        "@type": "ClaimReview",
        author: { name: "Example Checker", url: "https://example.org/", image: "https://example.org/logo.png" },
        claimReviewed: "A claim",
        datePublished: "2026-10-30",
        url: "https://example.org/check/1",
        reviewRating: { alternateName: "False", ratingValue: 1, bestRating: 5, image: "https://example.org/r.png" },
        reviewBody: "A long explanation of why the claim is false, copied from the article.",
        image: "https://example.org/hero.jpg",
        itemReviewed: {
          "@type": "Claim",
          appearance: [{ url: "https://other.example/post", headline: "Where it appeared" }],
          firstAppearance: { url: "https://other.example/first" },
          author: { name: "Someone" },
        },
        sdPublisher: { name: "Google Fact Check Tools" },
      },
    ]);

    const entries = await collect(path);

    expect(entries).toEqual([
      {
        kind: "review",
        review: {
          claimText: "A claim",
          ratingText: "False",
          publisher: "Example Checker",
          publishedDate: "2026-10-30",
          url: "https://example.org/check/1",
          originalUrl: "https://other.example/first",
          originalAuthor: "Someone",
        },
      },
    ]);
    const serialized = JSON.stringify(entries);
    expect(serialized).not.toContain("explanation");
    expect(serialized).not.toContain("hero.jpg");
    expect(serialized).not.toContain("other.example/post");
    expect(serialized).not.toContain("Where it appeared");
  });
});

describe("Data Commons adapter: tolerating missing parts", () => {
  it("returns undefined for each missing part instead of failing", async () => {
    const path = await writeFeed("missing.json", [
      { "@type": "ClaimReview" },
      { "@type": "ClaimReview", claimReviewed: "Only a claim" },
      { "@type": "ClaimReview", author: {}, reviewRating: {}, url: "https://example.org/x" },
      { "@type": "ClaimReview", claimReviewed: "", datePublished: "", url: "" },
    ]);

    const reviews = reviewsOf(await collect(path));

    expect(reviews).toEqual([
      {},
      { claimText: "Only a claim" },
      { url: "https://example.org/x" },
      {},
    ]);
  });

  it("treats values of the wrong type as missing", async () => {
    const path = await writeFeed("wrong-types.json", [
      { claimReviewed: 42, url: ["https://example.org/a"], author: "a string", reviewRating: { alternateName: { text: "x" } }, datePublished: 20261030 },
    ]);

    expect(reviewsOf(await collect(path))).toEqual([{}]);
  });

  it("reports an entry that is not an object as malformed and keeps going", async () => {
    const path = await writeFeed("malformed.json", [
      "not-a-review",
      null,
      [1, 2],
      { claimReviewed: "Still read", url: "https://example.org/ok" },
    ]);

    const entries = await collect(path);

    expect(entries.map((entry) => entry.kind)).toEqual(["malformed", "malformed", "malformed", "review"]);
  });

  it("reports a feed element without an item list as one malformed entry", async () => {
    const path = join(workDir, "no-items.json");
    await writeFile(
      path,
      JSON.stringify({
        dataFeedElement: [
          { "@type": "DataFeedItem" },
          { "@type": "DataFeedItem", item: "oops" },
          { "@type": "DataFeedItem", item: [{ claimReviewed: "Fine", url: "https://example.org/fine" }] },
        ],
      }),
    );

    const entries = await collect(path);

    expect(entries.map((entry) => entry.kind)).toEqual(["malformed", "malformed", "review"]);
  });

  it("fails for content that is not a feed at all", async () => {
    const path = join(workDir, "not-a-feed.json");
    await writeFile(path, JSON.stringify({ hello: "world" }));
    await expect(collect(path)).rejects.toThrow(/feed/i);

    const garbage = join(workDir, "garbage.json");
    await writeFile(garbage, "<html>not json</html>");
    await expect(collect(garbage)).rejects.toThrow();
  });

  it("fails when the feed has elements but not a single review", async () => {
    const renamed = join(workDir, "renamed-items.json");
    await writeFile(renamed, JSON.stringify({ dataFeedElement: [{ itemRenamed: [{ claimReviewed: "x" }] }] }));
    await expect(collect(renamed)).rejects.toThrow(/no reviews/i);

    const empty = join(workDir, "empty-items.json");
    await writeFile(empty, JSON.stringify({ dataFeedElement: [{ item: [] }, { item: ["not-a-review"] }] }));
    await expect(collect(empty)).rejects.toThrow(/no reviews/i);
  });
});
