import type { FeedCard } from "./claims-query";

/** What `GET /api/claims` returns. `total` is set on a first page only, `nextCursor` is null on the last page. */
export type FeedPageResponse = { items: FeedCard[]; nextCursor: string | null; total: number | null };

/**
 * The list the reader sees. `key` identifies the search and filters the list belongs to, and `generation` counts the
 * times the list was started again, so an answer to an old request can be told apart and dropped (design U6).
 */
export type ListState = {
  items: FeedCard[];
  total: number | null;
  nextCursor: string | null;
  /** The cursor of the request being made (or last made); null for a first page. */
  requestCursor: string | null;
  status: "idle" | "loading" | "error";
  key: string;
  generation: number;
};

export type ListAction =
  | { type: "filters"; key: string }
  | { type: "loadMore" }
  | { type: "retry" }
  | { type: "loaded"; generation: number; page: FeedPageResponse }
  | { type: "failed"; generation: number };

export function createListState(initial: FeedPageResponse, key: string): ListState {
  return { items: initial.items, total: initial.total, nextCursor: initial.nextCursor, requestCursor: null, status: "idle", key, generation: 0 };
}

/** True while there is a next page and no request is running or has just failed. */
export function shouldLoadMore(state: ListState): boolean {
  return state.status === "idle" && state.nextCursor !== null;
}

export function listReducer(state: ListState, action: ListAction): ListState {
  switch (action.type) {
    case "filters":
      if (action.key === state.key) return state;
      return { items: [], total: null, nextCursor: null, requestCursor: null, status: "loading", key: action.key, generation: state.generation + 1 };
    case "loadMore":
      return shouldLoadMore(state) ? { ...state, status: "loading", requestCursor: state.nextCursor } : state;
    case "retry":
      return state.status === "error" ? { ...state, status: "loading" } : state;
    case "loaded": {
      if (action.generation !== state.generation) return state;
      const shown = new Set(state.items.map((c) => c.id));
      return {
        ...state,
        items: [...state.items, ...action.page.items.filter((c) => !shown.has(c.id))],
        total: action.page.total ?? state.total,
        nextCursor: action.page.nextCursor,
        status: "idle",
      };
    }
    case "failed":
      return action.generation === state.generation ? { ...state, status: "error" } : state;
  }
}
