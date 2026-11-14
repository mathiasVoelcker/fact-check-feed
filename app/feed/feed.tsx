"use client";
import { useEffect, useReducer, useRef, useState } from "react";
import type { RatingCategory } from "../../src/db/schema";
import { type FeedPageResponse, createListState, listReducer, shouldLoadMore } from "../../src/feed/scroll";
import { ClaimCard } from "./claim-card";

type Props = {
  initial: FeedPageResponse;
  choices: { publishers: string[]; categories: RatingCategory[] };
  attribution: string;
};

const SEARCH_DEBOUNCE_MS = 300;

/** The query string for the claims route; the order and the page size are fixed on the server. */
function queryString(search: string, category: string, publisher: string, cursor: string | null) {
  const params = new URLSearchParams();
  if (search.trim()) params.set("q", search.trim());
  if (category) params.set("category", category);
  if (publisher) params.set("publisher", publisher);
  if (cursor) params.set("cursor", cursor);
  return params.toString();
}

/** Shown when nothing is stored (no filters) or nothing matches (with a way back). */
export function EmptyState({ filtered, onClear }: { filtered: boolean; onClear: () => void }) {
  return (
    <p>
      {filtered ? "No fact-checks match." : "No fact-checks yet."}{" "}
      {filtered && <button onClick={onClear}>Clear the search and filters</button>}
    </p>
  );
}

export function Feed({ initial, choices, attribution }: Props) {
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [category, setCategory] = useState("");
  const [publisher, setPublisher] = useState("");
  const key = JSON.stringify([debounced.trim(), category, publisher]);
  const [state, dispatch] = useReducer(listReducer, undefined, () => createListState(initial, key));
  const sentinel = useRef<HTMLDivElement>(null);
  const filtered = key !== JSON.stringify(["", "", ""]);

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(search), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search]);

  // A change of search or filters starts the list again from its first page (the reducer ignores an unchanged key).
  useEffect(() => dispatch({ type: "filters", key }), [key]);

  // Runs the request the state asks for; changing the filters or leaving the page aborts the one in flight.
  useEffect(() => {
    if (state.status !== "loading") return;
    const controller = new AbortController();
    const { generation } = state;
    fetch(`/api/claims?${queryString(debounced, category, publisher, state.requestCursor)}`, { signal: controller.signal })
      .then((res) => (res.ok ? (res.json() as Promise<FeedPageResponse>) : Promise.reject(new Error(String(res.status)))))
      .then((page) => dispatch({ type: "loaded", generation, page }))
      .catch(() => {
        if (!controller.signal.aborted) dispatch({ type: "failed", generation });
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.status, state.generation, state.requestCursor]);

  // Asks for the next page when the end of the list comes within view.
  const canLoadMore = shouldLoadMore(state);
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !canLoadMore) return;
    const observer = new IntersectionObserver((entries) => entries[0]?.isIntersecting && dispatch({ type: "loadMore" }), { rootMargin: "400px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [canLoadMore, state.items.length]);

  const clear = () => {
    setSearch("");
    setDebounced("");
    setCategory("");
    setPublisher("");
  };
  const loadingFirst = state.status === "loading" && state.items.length === 0;
  const empty = state.status === "idle" && state.total === 0;

  return (
    <main style={{ maxWidth: 860, margin: "0 auto", padding: "24px 16px 64px", fontFamily: "system-ui, sans-serif", lineHeight: 1.45 }}>
      <h1 style={{ marginBottom: 4 }}>Fact-check feed</h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        {state.total === null ? "Loading…" : `${state.total} fact-check${state.total === 1 ? "" : "s"} match`}
      </p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search claims, publishers, explanations…"
          aria-label="Search fact-checks"
          maxLength={200}
          style={{ flex: "1 1 240px", padding: "6px 8px" }}
        />
        <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by rating">
          <option value="">All ratings</option>
          {choices.categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        <select value={publisher} onChange={(e) => setPublisher(e.target.value)} aria-label="Filter by publisher">
          <option value="">All publishers</option>
          {choices.publishers.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
      </div>

      {empty && <EmptyState filtered={filtered} onClear={clear} />}
      {loadingFirst && <p style={{ color: "#555" }}>Loading…</p>}

      <div style={{ display: "grid", gap: 12 }}>
        {state.items.map((claim) => (
          <ClaimCard key={claim.id} claim={claim} />
        ))}
      </div>

      {state.status === "error" && (
        <p role="alert">
          Could not load more. <button onClick={() => dispatch({ type: "retry" })}>Try again</button>
        </p>
      )}
      {state.nextCursor !== null && state.status !== "error" && (
        <div ref={sentinel} style={{ padding: 16, textAlign: "center", color: "#555" }}>Loading more…</div>
      )}

      <footer style={{ marginTop: 40, color: "#555", fontSize: 13 }}>{attribution}</footer>
    </main>
  );
}
