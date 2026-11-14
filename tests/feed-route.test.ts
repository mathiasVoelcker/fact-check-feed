import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { claims, type NewClaim } from "../src/db/schema";
import { handleClaimsRequest, MAX_SEARCH_LENGTH } from "../src/feed/claims-route";
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
afterEach(() => {
  vi.unstubAllGlobals();
});

let n = 0;
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

type Body = { items: { id: number; claimText: string }[]; nextCursor: string | null; total: number | null };
const get = (query = "") => handleClaimsRequest(t.db, new URL(`http://localhost/api/claims${query}`));
const json = async (query = "") => (await (await get(query)).json()) as Body;

describe("claims route", () => {
  it("returns the first page with the total and a cursor when more claims match", async () => {
    for (let i = 0; i < 60; i++) await add();
    const body = await json();
    expect(body.items).toHaveLength(50);
    expect(body.total).toBe(60);
    expect(body.nextCursor).toEqual(expect.any(String));
  });

  it("returns the next page for a cursor, with no total, and no cursor on the last page", async () => {
    for (let i = 0; i < 60; i++) await add();
    const first = await json();
    const second = await json(`?cursor=${encodeURIComponent(first.nextCursor!)}`);
    expect(second.items).toHaveLength(10);
    expect(second.total).toBeNull();
    expect(second.nextCursor).toBeNull();
    expect(new Set([...first.items, ...second.items].map((c) => c.id)).size).toBe(60);
  });

  it("applies search, category and publisher from the query string, and the total follows", async () => {
    await add({ claimText: "match me", publisher: "P1", category: "false" });
    await add({ claimText: "match me", publisher: "P2", category: "false" });
    await add({ claimText: "match me", publisher: "P1", category: "true" });
    const body = await json("?q=match&category=false&publisher=P1");
    expect(body.items.map((c) => c.claimText)).toEqual(["match me"]);
    expect(body.total).toBe(1);
  });

  it("returns an empty page and a zero total when nothing matches", async () => {
    await add();
    expect(await json("?q=nothing-like-this")).toEqual({ items: [], nextCursor: null, total: 0 });
  });

  it("answers with JSON and does not let the response be cached", async () => {
    const res = await get();
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(res.headers.get("cache-control")).toContain("no-store");
  });

  it.each(["?category=nonsense", "?category=FALSE", "?cursor=abc", "?cursor=2026-13-45_1", "?cursor=2026-11-01_x", "?cursor=2026-11-01_0"])(
    "rejects %s with 400",
    async (query) => {
      const res = await get(query);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: expect.any(String) });
    },
  );

  it("rejects a search longer than the cap and accepts one at the cap", async () => {
    expect((await get(`?q=${"a".repeat(MAX_SEARCH_LENGTH + 1)}`)).status).toBe(400);
    expect((await get(`?q=${"a".repeat(MAX_SEARCH_LENGTH)}`)).status).toBe(200);
  });

  it("ignores query parameters it does not know, including any that ask for another order or page size", async () => {
    for (let i = 0; i < 60; i++) await add();
    const body = await json("?sort=severity&limit=500&offset=10");
    expect(body.items).toHaveLength(50);
  });

  it("makes no request to an original-claim URL or any other host while serving pages", async () => {
    await add({ originalUrl: "https://www.facebook.com/share/p/abc/", url: "https://publisher.example/a" });
    const fetchSpy = vi.fn(() => Promise.reject(new Error("no network in this test")));
    vi.stubGlobal("fetch", fetchSpy);
    expect((await get()).status).toBe(200);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
