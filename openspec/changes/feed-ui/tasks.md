# Tasks

## 1. Claims query (tests first)

- [x] 1.1 Write PGlite tests in `tests/feed-query.test.ts` for order (newest first, `id` tie-break), a 50-row page, the cursor (no duplicates or gaps over all pages, including a claim inserted after page one), the total count, and distinct publisher and category choices; verify they fail before implementation
- [x] 1.2 Add search tests to the same file (all words must match, case-insensitive, `%` `_` `\` literal, searched fields only, combined with category and publisher filters); verify they fail before implementation
- [x] 1.3 Implement `src/feed/claims-query.ts` (filters, keyset cursor, page, count, choices; parameterized SQL) and verify `npx vitest run tests/feed-query.test.ts` passes
- [x] 1.4 Add `src/db/client.ts` (shared pool and Drizzle instance from `DATABASE_URL`, server only) and verify `npm run typecheck` passes
- [x] 1.5 Update `docs/architecture.md` (new component, where it lives, U1 and U2) and verify the existing `tests/docs.test.ts` still passes

## 2. Origin label and card (tests first)

- [x] 2.1 Write `tests/feed-card.test.ts` using `renderToStaticMarkup`: full card, card without explanation (fact-check link text says where to read the reasoning), card without origin has no origin block, the fact-check link attributes, and verify they fail before implementation
- [x] 2.2 In the same file, write the UI tests the project rules require for the origin: per category the block says false / misleading / "claim that was checked" and the non-false categories never contain "false" or "misleading" about the claim; the "not a source" wording; the rating badge and rating text are on the same card; the link has `rel="noopener noreferrer nofollow"` and `target="_blank"`, shows the host with a warning marker and not the full URL; a non-http(s) URL gets no link; verify they fail before implementation
- [x] 2.3 Implement `src/feed/origin-label.ts` (the U3 table) and the card and origin block in `app/feed/claim-card.tsx`, reusing `isHttpUrl`; verify `npx vitest run tests/feed-card.test.ts` passes

## 3. Feed page, route and scrolling (tests first)

- [x] 3.1 Write route tests in `tests/feed-route.test.ts` against PGlite: first page, cursor page, filters and search passed as query params, invalid category or cursor rejected with 400, search length capped; verify they fail before implementation
- [x] 3.2 Write a unit test for the pure scroll-trigger and reset logic (`tests/feed-scroll.test.ts`): next page requested only while a cursor exists and none is in flight, none after the last page, filter change resets; verify it fails before implementation
- [x] 3.3 Implement `app/api/claims/route.ts` and verify `npx vitest run tests/feed-route.test.ts` passes
- [x] 3.4 Implement `app/page.tsx` (server: first page, total, choices, attribution from the allowlist), `app/feed/feed.tsx` (search, filters, no sort control, observer, abort on change, retry on error, empty and no-match states) in plain, readable styling only, and verify `tests/feed-scroll.test.ts` passes
- [x] 3.5 Add a test that the page markup contains the allowlist attribution text and no sort control, and that nothing under `app/` or `src/feed/` fetches an original or publisher URL (a source scan like `tests/legal.test.ts` does); verify it passes

## 4. Remove the prototype and finish

- [x] 4.1 Delete `app/prototype-feed/` and verify `git grep prototype-feed` finds no code reference and `npm run typecheck` passes
- [x] 4.2 Map every scenario of `specs/claim-feed/spec.md` in `tests/spec-coverage.test.ts` (COVERAGE table and the expected scenario count) and verify `npx vitest run tests/spec-coverage.test.ts` passes
- [x] 4.3 Update `tests/test-guide.md` (new test files; the known gap that scrolling in a real browser is untested; remove the "browser tests arrive with the UI change" line) and `CLAUDE.md` if its pointers change; verify `tests/docs.test.ts` passes
- [ ] 4.4 Run `npm test`, `npm run typecheck` and `openspec validate feed-ui --strict`, then `npm run dev` and look at the feed with the real database (first load, scroll to the end, search, each filter, a card with and without origin) and confirm the count and label behave as in the spec

## Workflow follow-up

- Archive the change after review (`/opsx:archive`), which creates `openspec/specs/claim-feed/`.
- Consider a later change for visual design, one for ranking once classification settles, and one for Playwright tests.
