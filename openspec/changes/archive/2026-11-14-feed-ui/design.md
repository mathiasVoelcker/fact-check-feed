# Design

## Context

See proposal.md for motivation. Current state:

- `claims` (Drizzle, `src/db/schema.ts`) holds the stored fields, including `rating_explanation`, `original_url`, `original_venue`, `original_author`, `category` and `severity`. Rows older than 90 days are removed by each ingestion run. About 300 rows are stored now.
- The Next.js app only has a placeholder `app/page.tsx`. The cards prototype lives in `app/prototype-feed/` and reads a static JSON snapshot; its filters, search and infinite scroll run in the browser over all rows.
- The ingestion CLI builds its database with `drizzle(new pg.Pool(...), { schema })` (`src/cli/ingest.ts`). Tests use PGlite with the real migrations (`tests/support/db.ts`).
- E7 of `store-claim-context` governs how the origin fields may be shown.

## Goals / Non-Goals

**Goals:**
- Serve the real claims from the database, with correct ordering, paging, count, search and filters.
- Keep the origin label honest for every rating category and compliant with E7.
- Keep the query and the card testable without a browser, a network or a live database.

**Non-Goals:**
- Visual design (a later change), ranking, sorting, detail pages, caching strategy, Playwright tests.
- Any change to ingestion, the schema or stored data.

## Decisions

### U1. ADR: the page reads the database on the server; the browser never gets all rows

`app/page.tsx` is a Server Component that reads the first page, the total count and the filter choices through a query module (`src/feed/claims-query.ts`) taking a `Database`, as the ingestion code does. Later pages come from a route handler (`app/api/claims/route.ts`) that calls the same module. A small client component owns the search box, the filters and the scroll sentinel, and appends the pages it fetches.

**Why.** The table is small now (about 300 rows) but is a rolling window of a feed that can grow; shipping every row, as the prototype's snapshot does, would make "N shown" honest only by accident. Querying on the server makes the count, search and filters correct at any size, keeps `DATABASE_URL` server-side, and keeps the query testable with PGlite like the rest of the code.

**Alternatives.**
- Keep the static-snapshot approach with client-side filtering: simplest, but stale until redeploy and not scalable; fine for a prototype only.
- Server Actions for further pages: fewer files, but a plain GET route is easier to test and to reason about for search params.
- Read the database from the browser (Neon serverless driver): exposes the connection string. Rejected.

**Revisit trigger.** The window grows beyond a few thousand rows, or reads need caching.

### U2. ADR: keyset pagination on (published_on, id)

Pages are fetched by a cursor, not by offset: the order is `published_on desc, id desc`, and the cursor is the last shown `(published_on, id)`. The next page is `where (published_on, id) < (cursor)` with `limit 50`. The response carries the next cursor, or none on the last page.

**Why.** An ingestion run can insert claims between page loads. With offset paging a new newer claim shifts every later row and the next page repeats one; the spec requires no duplicates and no gaps. `id` is unique, so the order is total and stable (it is also the tie-break the spec asks for). The total count is a separate `count(*)` with the same filters, computed once per query, not per page.

**Alternatives.** Offset paging (simple, but duplicates on insert). Cursor on `ingested_at` (not the displayed order).

### U3. ADR: origin label wording depends on the rating category

E7 says the origin must be shown as the false or misleading content itself. A fixed "The fake news itself (rated false)" is wrong when the claim is rated true, mixed or unproven: the card would call a true claim false. The wording is chosen by `category` from one table in one place, so a test can read it:

| Category | Block heading | Line under it |
| --- | --- | --- |
| `false` | The false claim, as it was posted | This is the false claim itself, not a source. |
| `misleading` | The misleading claim, as it was posted | This is the misleading claim itself, not a source. |
| `true`, `mixed`, `unproven`, `unclassifiable` | The claim that was checked, as it was posted | This is the claim that was checked, not a source. Read the rating and the fact-check to see how it held up. |

Then, in every case, the author and venue as given (for example "Facebook page Sakay Commentary · In a Facebook post"), then the link.

**Why.** For false and misleading the label stays as strong as E7 asks. For the rest, the honest statement is "this is what was checked", which still tells a reader that the page behind the link is not evidence. The category (our classification) drives the wording, not the free-text rating, which can be in any language.

**Deviation to confirm.** E7 and the `specs` rule in `openspec/config.yaml` are written for false or misleading claims. For other categories this design uses the "claim that was checked" wording above, which keeps the other E7 requirements (plain words, next to the rating, never a source, rel attributes, unusual link). It is the owner's call whether the config rule should say this too; this change does not edit the config.

**Alternatives.** One neutral sentence for every category (simple, but weakens the warning on the false claims that are the common case); hide the origin unless the category is false or misleading (loses data and hides context for mixed and unproven).

**Revisit trigger.** The classification system changes (categories added, or severity used for display).

### U4. Original-claim link

The link text is the host only, with a warning marker and the words "not a source", in a monospace style with a dashed or red treatment so it reads differently from the fact-check link. It has `target="_blank"` and `rel="noopener noreferrer nofollow"`. It is rendered only when the value passes the same http(s) test as ingestion (`isHttpUrl`, `src/pipeline/filters.ts`), reused rather than copied, as defense in depth even though ingestion already drops other values. The server never fetches it. When there is no valid URL but an author or venue exists, the block is shown without the link. The block is never rendered outside a card, so it always sits with the rating.

### U5. Search and filters run in SQL

- Search: the text is split on whitespace; each word becomes an `ILIKE '%word%'` over claim text, rating text, rating explanation, publisher and original author, with `%`, `_` and `\` escaped so they match literally; words are ANDed.
- Rating and publisher filters are equality tests on `category` and `publisher`. Choices come from `select distinct` over the table, so they follow the data (the prototype derived them in the browser from its snapshot).
- The prototype did not search `original_venue` or the URLs, and neither does this: the spec lists the searched fields.
- Plain `ILIKE` without an index is fine for hundreds of rows. Full-text search is a future option if the window grows.
- Query inputs are parameters, never concatenated. The route validates `limit`-free input: the page size is fixed at 50, the category must be one of `RATING_CATEGORIES`, the cursor must parse, and the search text is capped in length.

### U6. Pagination in the browser

An `IntersectionObserver` on a sentinel under the last card requests the next page when it is within about 400 px of view. Changing the search or a filter aborts any request in flight, clears the shown cards and asks for the first page of the new query (search is debounced). A loading marker shows while a page is requested and disappears on the last page. A failed page request shows a "could not load more" message with a retry button instead of silently stopping. The page shows `total` from the server, so the "N shown" count is the number of matches and not of rendered cards.

### U7. Attribution and honest page text

The page reads the attribution text from the allowlist entry (`data-commons-claimreview`) rather than hardcoding it, so the text stays tied to the license record. The prototype's hardcoded "from the last 90 days" is dropped, since the window is an ingestion rule and the page only knows what is stored.

### U8. ADR: tests without a browser for now

Tests are vitest tests: the query module against PGlite with the real migrations (order, cursor paging including an insert between pages, search escaping, filters, count, distinct choices); the route handler called as a function against PGlite; the card and origin block rendered with `react-dom/server` (`renderToStaticMarkup`), asserting the per-category label, the `rel` and `target` attributes and the absence of the block without an origin; a test that the page source has no sort control and performs no `fetch` to origin URLs. The scroll behavior (observer, abort, retry) is kept small in one hook and its trigger logic in a pure function that is unit-tested.

**Why.** `tests/test-guide.md` says Playwright arrives with the UI change, but a browser test needs a running Next server on a seeded Postgres, which PGlite cannot serve to a separate process. Adding that harness is its own piece of work, larger than this change; the config rule asks for a UI test of the label and rel attributes, which the rendered-markup tests satisfy.

**Known gap, recorded in the test guide.** Real scrolling in a real browser is untested. Revisit with a Playwright change that also covers the styled page.

### U9. Where code lives

- `src/feed/claims-query.ts`: filters, cursor, page and count queries, filter choices. No React, no Next.
- `src/feed/origin-label.ts`: the category-to-wording table (U3).
- `app/page.tsx`: server page. `app/api/claims/route.ts`: pages as JSON.
- `app/feed/` (or colocated): `claim-card.tsx` (card and origin block), `feed.tsx` (client: search, filters, scroll), small and plain inline or a single CSS file.
- `src/db/client.ts`: a lazily created `pg.Pool` and `drizzle` shared across requests in the server process, reading `DATABASE_URL`; the ingestion CLI keeps its own.
- `app/prototype-feed/` is deleted, including its snapshot (it contains real claim text and is not needed any more).

## Risks / Trade-offs

- [A false claim is shown as a plain, trusted-looking link] → E7 label per category, host-only link with warning marker and "not a source", `nofollow`, never fetched; tests assert all of it.
- [A claim rated true is called false by a fixed label] → U3: wording by category; scenario and test for the non-false categories.
- [Classification is immature (`unclassifiable` and wrong categories exist), so category-driven wording can be wrong] → the label for non-false categories never asserts falseness; the rating text and the explanation sit on the same card; ranking is not done yet.
- [Author names can identify private people (E6)] → shown only inside the labeled block as who made the claim, never as a source; unchanged from E6.
- [No ordering by importance] → accepted for now; newest first is predictable. Ranking comes with a later change once classification settles.
- [`ILIKE` scans the table] → fine at this size, revisit trigger in U1.
- [The database is on Neon with scale-to-zero, so the first request can be slow] → accepted for a learning project; no caching in this change.
- [Insert between page loads] → keyset pagination (U2); the total count may then be one lower than the rows eventually loaded, which is acceptable and documented in the spec scenario wording ("matched at the start").
- [No real-browser test of scrolling] → U8, recorded as a known gap.
- [Config says ranking by recency and severity] → deliberately not done here; noted in the proposal.
