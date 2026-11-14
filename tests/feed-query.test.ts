import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claims, type NewClaim } from "../src/db/schema";
import { PAGE_SIZE, countClaims, getFeedPage, getFilterChoices, type Cursor, type FeedFilters } from "../src/feed/claims-query";
import { createTestDb } from "./support/db";

let t: Awaited<ReturnType<typeof createTestDb>>;

beforeAll(async () => {
  t = await createTestDb();
});
afterAll(async () => {
  await t.close();
});
beforeEach(async () => {
  await t.db.delete(claims);
});

let n = 0;
/** Inserts one claim with sensible defaults; each call gets its own URL. */
async function add(over: Partial<NewClaim> = {}) {
  n++;
  await t.db.insert(claims).values({
    url: `https://example.org/check/${n}`,
    claimText: `Claim number ${n}`,
    ratingText: "False",
    publisher: "Publisher A",
    publishedOn: "2026-11-01",
    sourceId: "data-commons-claimreview",
    category: "false",
    ...over,
  });
}

/** Reads every page of a query in turn, as the browser does. */
async function readAll(filters: FeedFilters = {}) {
  const pages: Awaited<ReturnType<typeof getFeedPage>>[] = [];
  let cursor: Cursor | undefined;
  do {
    const page = await getFeedPage(t.db, filters, cursor);
    pages.push(page);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return pages;
}

describe("feed query: order and pages", () => {
  it("lists the newest review date first", async () => {
    await add({ claimText: "old", publishedOn: "2026-10-01" });
    await add({ claimText: "newest", publishedOn: "2026-11-10" });
    await add({ claimText: "middle", publishedOn: "2026-10-20" });
    const { items } = await getFeedPage(t.db, {});
    expect(items.map((c) => c.claimText)).toEqual(["newest", "middle", "old"]);
  });

  it("keeps the same order for claims that share a date: the higher id first", async () => {
    for (const name of ["a", "b", "c"]) await add({ claimText: name, publishedOn: "2026-11-05" });
    const first = await getFeedPage(t.db, {});
    const second = await getFeedPage(t.db, {});
    expect(first.items.map((c) => c.claimText)).toEqual(["c", "b", "a"]);
    expect(second.items).toEqual(first.items);
  });

  it("returns exactly one page of 50 and a cursor when more claims match", async () => {
    for (let i = 0; i < PAGE_SIZE + 5; i++) await add();
    const page = await getFeedPage(t.db, {});
    expect(PAGE_SIZE).toBe(50);
    expect(page.items).toHaveLength(50);
    expect(page.nextCursor).not.toBeNull();
  });

  it("returns no cursor on the last page", async () => {
    for (let i = 0; i < 3; i++) await add();
    const page = await getFeedPage(t.db, {});
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeNull();
  });

  it("returns no cursor when exactly one full page matches", async () => {
    for (let i = 0; i < PAGE_SIZE; i++) await add();
    expect((await getFeedPage(t.db, {})).nextCursor).toBeNull();
  });

  it("returns an empty page for an empty table", async () => {
    expect(await getFeedPage(t.db, {})).toEqual({ items: [], nextCursor: null });
  });

  it("shows each matching claim exactly once over all pages, also with many sharing a date", async () => {
    for (let i = 0; i < 120; i++) await add({ publishedOn: i % 2 ? "2026-11-02" : "2026-11-03" });
    const pages = await readAll();
    const ids = pages.flatMap((p) => p.items.map((c) => c.id));
    expect(pages.map((p) => p.items.length)).toEqual([50, 50, 20]);
    expect(new Set(ids).size).toBe(120);
  });

  it("neither repeats nor skips a claim when a newer claim is stored after the first page was loaded", async () => {
    for (let i = 0; i < 120; i++) await add({ publishedOn: "2026-11-01" });
    const first = await getFeedPage(t.db, {});
    await add({ claimText: "arrived later", publishedOn: "2026-11-10" });
    const rest: number[] = [];
    let cursor = first.nextCursor ?? undefined;
    while (cursor) {
      const page = await getFeedPage(t.db, {}, cursor);
      rest.push(...page.items.map((c) => c.id));
      cursor = page.nextCursor ?? undefined;
    }
    const all = [...first.items.map((c) => c.id), ...rest];
    expect(all).toHaveLength(120);
    expect(new Set(all).size).toBe(120);
  });

  it("returns only the fields a card needs", async () => {
    await add({ ratingExplanation: "Why", originalUrl: "https://x.example/p", originalVenue: "In a post", originalAuthor: "Someone" });
    const [card] = (await getFeedPage(t.db, {})).items;
    expect(Object.keys(card!).sort()).toEqual(
      [
        "id", "url", "claimText", "ratingText", "ratingExplanation", "originalUrl", "originalVenue", "originalAuthor",
        "publisher", "publishedOn", "category",
      ].sort(),
    );
  });
});

describe("feed query: count and choices", () => {
  it("counts all matching claims, not one page", async () => {
    for (let i = 0; i < 70; i++) await add();
    expect(await countClaims(t.db, {})).toBe(70);
  });

  it("counts only claims matching the filters", async () => {
    await add({ publisher: "P1", category: "true" });
    await add({ publisher: "P1", category: "false" });
    await add({ publisher: "P2", category: "false" });
    expect(await countClaims(t.db, { publisher: "P1" })).toBe(2);
    expect(await countClaims(t.db, { category: "false" })).toBe(2);
    expect(await countClaims(t.db, { publisher: "P1", category: "false" })).toBe(1);
  });

  it("offers exactly the publishers and categories present, sorted", async () => {
    await add({ publisher: "Zeta", category: "mixed" });
    await add({ publisher: "alpha", category: "false" });
    await add({ publisher: "Zeta", category: "false" });
    const choices = await getFilterChoices(t.db);
    expect(choices.publishers).toEqual(["alpha", "Zeta"]);
    expect(choices.categories).toEqual(["false", "mixed"]);
  });

  it("offers no choices for an empty table", async () => {
    expect(await getFilterChoices(t.db)).toEqual({ publishers: [], categories: [] });
  });
});

describe("feed query: search and filters", () => {
  const texts = async (filters: FeedFilters) => (await readAll(filters)).flatMap((p) => p.items.map((c) => c.claimText)).sort();

  it("requires every word to match, in any order", async () => {
    await add({ claimText: "Duterte trial at the ICC" });
    await add({ claimText: "Duterte rally" });
    await add({ claimText: "ICC budget" });
    expect(await texts({ search: "icc duterte" })).toEqual(["Duterte trial at the ICC"]);
  });

  it("ignores letter case", async () => {
    await add({ claimText: "Vaccines cause X" });
    expect(await texts({ search: "VACCINES" })).toEqual(["Vaccines cause X"]);
  });

  it("ignores extra whitespace and treats an empty search as no search", async () => {
    await add({ claimText: "one" });
    await add({ claimText: "two" });
    expect(await texts({ search: "   " })).toEqual(["one", "two"]);
    expect(await texts({ search: "  one  " })).toEqual(["one"]);
  });

  it("matches in the rating text, explanation, publisher and original author", async () => {
    await add({ claimText: "c1", ratingText: "Pants on Fire" });
    await add({ claimText: "c2", ratingExplanation: "Photo is from 2019" });
    await add({ claimText: "c3", publisher: "VERA Files" });
    await add({ claimText: "c4", originalAuthor: "Facebook page Naknak" });
    expect(await texts({ search: "pants" })).toEqual(["c1"]);
    expect(await texts({ search: "2019" })).toEqual(["c2"]);
    expect(await texts({ search: "vera" })).toEqual(["c3"]);
    expect(await texts({ search: "naknak" })).toEqual(["c4"]);
  });

  it("does not search the original venue or any URL", async () => {
    await add({ claimText: "c1", originalVenue: "In a Telegram channel", originalUrl: "https://secret-host.example/post" });
    expect(await texts({ search: "telegram" })).toEqual([]);
    expect(await texts({ search: "secret-host" })).toEqual([]);
  });

  it("matches % _ and \\ only as themselves", async () => {
    await add({ claimText: "Up 50% this year" });
    await add({ claimText: "Up 50 this year" });
    await add({ claimText: "snake_case name" });
    await add({ claimText: "snakeXcase name" });
    await add({ claimText: "path a\\b here" });
    expect(await texts({ search: "50%" })).toEqual(["Up 50% this year"]);
    expect(await texts({ search: "%" })).toEqual(["Up 50% this year"]);
    expect(await texts({ search: "snake_case" })).toEqual(["snake_case name"]);
    expect(await texts({ search: "a\\b" })).toEqual(["path a\\b here"]);
  });

  it("treats quotes and SQL text as plain text", async () => {
    await add({ claimText: "It's fine" });
    expect(await texts({ search: "it's" })).toEqual(["It's fine"]);
    expect(await texts({ search: "'; drop table claims; --" })).toEqual([]);
    expect(await countClaims(t.db, {})).toBe(1);
  });

  it("combines category, publisher and search", async () => {
    await add({ claimText: "match me", publisher: "P1", category: "false" });
    await add({ claimText: "match me", publisher: "P2", category: "false" });
    await add({ claimText: "match me", publisher: "P1", category: "true" });
    await add({ claimText: "other", publisher: "P1", category: "false" });
    const filters: FeedFilters = { search: "match", publisher: "P1", category: "false" };
    expect(await texts(filters)).toEqual(["match me"]);
    expect(await countClaims(t.db, filters)).toBe(1);
  });

  it("pages through filtered results without leaking other claims", async () => {
    for (let i = 0; i < 60; i++) await add({ category: "false" });
    for (let i = 0; i < 10; i++) await add({ category: "true" });
    const pages = await readAll({ category: "false" });
    expect(pages.flatMap((p) => p.items).every((c) => c.category === "false")).toBe(true);
    expect(pages.flatMap((p) => p.items)).toHaveLength(60);
  });
});
