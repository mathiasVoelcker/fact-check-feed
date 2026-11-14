import { describe, expect, it } from "vitest";
import type { FeedCard } from "../src/feed/claims-query";
import { type FeedPageResponse, type ListState, createListState, listReducer, shouldLoadMore } from "../src/feed/scroll";

const card = (id: number): FeedCard => ({
  id, url: `https://example.org/${id}`, claimText: `c${id}`, ratingText: "False", ratingExplanation: null, originalUrl: null,
  originalVenue: null, originalAuthor: null, publisher: "P", publishedOn: "2026-11-01", category: "false",
});
const page = (ids: number[], nextCursor: string | null, total: number | null = null): FeedPageResponse => ({ items: ids.map(card), nextCursor, total });
const initial = (over: Partial<ListState> = {}) => ({ ...createListState(page([1, 2], "2026-11-01_2", 5), "k0"), ...over });

describe("feed scrolling logic", () => {
  it("starts idle with the server-rendered first page and its total", () => {
    const s = initial();
    expect(s.items.map((c) => c.id)).toEqual([1, 2]);
    expect(s.total).toBe(5);
    expect(s.status).toBe("idle");
  });

  it("asks for the next page only while a cursor exists and nothing is in flight", () => {
    expect(shouldLoadMore(initial())).toBe(true);
    expect(shouldLoadMore(initial({ status: "loading" }))).toBe(false);
    expect(shouldLoadMore(initial({ nextCursor: null }))).toBe(false);
  });

  it("does not ask again after a failure until the reader retries", () => {
    expect(shouldLoadMore(initial({ status: "error" }))).toBe(false);
  });

  it("starts loading with the cursor when the sentinel asks for more, and ignores a second ask while loading", () => {
    const loading = listReducer(initial(), { type: "loadMore" });
    expect(loading.status).toBe("loading");
    expect(loading.requestCursor).toBe("2026-11-01_2");
    expect(listReducer(loading, { type: "loadMore" })).toBe(loading);
  });

  it("appends a loaded page and takes its cursor, and stops when the last page arrives", () => {
    const loading = listReducer(initial(), { type: "loadMore" });
    const done = listReducer(loading, { type: "loaded", generation: loading.generation, page: page([3, 4, 5], null) });
    expect(done.items.map((c) => c.id)).toEqual([1, 2, 3, 4, 5]);
    expect(done.total).toBe(5);
    expect(done.nextCursor).toBeNull();
    expect(done.status).toBe("idle");
    expect(shouldLoadMore(done)).toBe(false);
  });

  it("never shows a claim twice, even if a page repeats one", () => {
    const loading = listReducer(initial(), { type: "loadMore" });
    const done = listReducer(loading, { type: "loaded", generation: loading.generation, page: page([2, 3], null) });
    expect(done.items.map((c) => c.id)).toEqual([1, 2, 3]);
  });

  it("changing the filters clears the list and starts again from the first page", () => {
    const next = listReducer(initial(), { type: "filters", key: "k1" });
    expect(next.items).toEqual([]);
    expect(next.total).toBeNull();
    expect(next.status).toBe("loading");
    expect(next.requestCursor).toBeNull();
    expect(next.key).toBe("k1");
    expect(next.generation).toBe(initial().generation + 1);
  });

  it("does nothing when the filters have not changed", () => {
    const s = initial();
    expect(listReducer(s, { type: "filters", key: "k0" })).toBe(s);
  });

  it("takes the new total from the first page of a new query", () => {
    const reset = listReducer(initial(), { type: "filters", key: "k1" });
    const done = listReducer(reset, { type: "loaded", generation: reset.generation, page: page([9], null, 1) });
    expect(done.items.map((c) => c.id)).toEqual([9]);
    expect(done.total).toBe(1);
  });

  it("ignores a page from a request that was superseded by a filter change", () => {
    const loading = listReducer(initial(), { type: "loadMore" });
    const reset = listReducer(loading, { type: "filters", key: "k1" });
    const late = listReducer(reset, { type: "loaded", generation: loading.generation, page: page([7, 8], null) });
    expect(late).toBe(reset);
  });

  it("shows an error on failure, and a retry asks for the same page again", () => {
    const loading = listReducer(initial(), { type: "loadMore" });
    const failed = listReducer(loading, { type: "failed", generation: loading.generation });
    expect(failed.status).toBe("error");
    expect(failed.items).toEqual(initial().items);
    const retry = listReducer(failed, { type: "retry" });
    expect(retry.status).toBe("loading");
    expect(retry.requestCursor).toBe("2026-11-01_2");
  });

  it("ignores a failure from a superseded request", () => {
    const loading = listReducer(initial(), { type: "loadMore" });
    const reset = listReducer(loading, { type: "filters", key: "k1" });
    expect(listReducer(reset, { type: "failed", generation: loading.generation })).toBe(reset);
  });
});
