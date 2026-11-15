# Design

## Context

The feed is a Next.js app. `app/page.tsx` reads the first page on the server and `app/feed/feed.tsx` fetches later pages from `/api/claims`. `src/db/client.ts` connects with `pg.Pool` to `DATABASE_URL`. The existing tests use PGlite inside the Vitest process (`tests/support/db.ts`), which a separately started Next server cannot connect to. See proposal.md for why.

The existing `data-badge`, `data-block="origin"` and `data-link` attributes in `claim-card.tsx`, and the aria-labels on the search box and the two selects, are enough to find every element the tests need.

## Goals / Non-Goals

**Goals:**
- Run the feed in a real browser against the production build and a real Postgres, with the real migrations.
- Make it impossible, by a check in code, to point the e2e setup at Neon or any non-local database.
- Keep `npm test` fast, offline and database-free.

**Non-Goals:**
- Replacing the Vitest tests. The query, route, card markup and reducer keep their tests; e2e adds only what needs a browser.
- Running the ingestion pipeline in e2e. The database is seeded directly.
- Multiple browsers or viewports.

## Decisions

### X1. ADR: a real Postgres service container, not PGlite over a socket

The Next server is a separate process, so the database must be reachable over TCP. Options: (a) a Postgres container (Docker locally, `services: postgres` in CI); (b) `@electric-sql/pglite-socket`.

Chosen: (a). It runs the real `pg` driver against real Postgres, as in production, and CI supports it natively. (b) avoids Docker but is not known to work with a `pg.Pool` that opens several connections; that would be a research task in its own right.

Cost: local runs need Docker. A one-line `docker run` is documented in the test guide, and `npm test` does not need it.

### X2. ADR: refuse any non-local database

The e2e `DATABASE_URL` comes from `E2E_DATABASE_URL`, never from `DATABASE_URL`, so the `.env` that points at Neon is not picked up by accident. A small function checks that the host is `localhost`, `127.0.0.1` or `::1` and throws otherwise, before any migration or seed. It is called by the global setup and by `playwright.config.ts`, and has an offline Vitest test (a Neon-style URL is refused, a local one accepted).

**Why.** `CLAUDE.md`: tests never hit Neon. The seed step deletes and inserts rows, so a wrong URL would destroy real data.

### X3. ADR: test the production build on its own port

`webServer` runs `next build && next start -p 3100` with `E2E_DATABASE_URL` passed as `DATABASE_URL`. Production mode matches what is deployed and avoids dev-only behavior (double-invoked effects in React strict mode would change how many requests the observer makes). Port 3100 avoids a clash with a running `npm run dev` on 3000, and `reuseExistingServer` is off so a stale server never serves old code.

Alternative: `next dev`, faster to start but different from production. Rejected.

### X4. Seed data: synthetic, fixed and inserted with Drizzle

`e2e/seed.ts` builds the rows in code, with a fixed set of dates so the order is known:
- 120 claims: enough for three pages (50, 50, 20).
- Several publishers; all six categories present.
- A claim for each of `false`, `misleading` and `true` with an origin (URL on a made-up `.invalid` host, venue, author); claims without origin; claims with and without an explanation; one with an unsafe (non-http) original URL is not insertable because ingestion would never store it, so that case stays covered by the markup tests.
- Words in claim text chosen so a search returns a known, small set.

`.invalid` hosts (RFC 2606) can never resolve, so even a bug that requested one would fail loudly instead of reaching a real site. Synthetic text also keeps third-party claim text out of the repository.

The global setup truncates `claims` and `rating_classifications`, applies the migrations in `drizzle/` with Drizzle's migrator, then inserts the seed. It runs once per test run; tests only read, so they are independent of each other. The one exception, the "new claim between pages" scenario, is left to the PGlite tests, which already cover it deterministically.

### X5. Failure and request checks use Playwright routing

- Retry button: `page.route("**/api/claims*", route => route.abort())` for the next-page request, assert the "Could not load more" alert, remove the route, click "Try again" and assert the cards arrive.
- No origin request: `page.on("request")` collects every request URL during a full scroll and a filter change; the test asserts none has a `.invalid` host or any host other than the test server's. This checks the browser; the server side is already covered by the source-scan test.

### X6. Tie e2e tests to the spec scenarios

`tests/spec-coverage.test.ts` maps scenarios to tests in `tests/`. e2e tests are not mapped there. Instead each e2e test title starts with `claim-feed :: <scenario title>`, and a small offline Vitest test reads the files in `e2e/` and fails when a title names a scenario that does not exist in `openspec/specs/claim-feed/spec.md`. It does not require that every scenario has an e2e test: most are covered below the browser, and the guide says which are browser-only.

### X7. Where code lives

- `playwright.config.ts`: Chromium only, one worker (one database), `webServer` as in X3, traces on first retry.
- `e2e/global-setup.ts`, `e2e/seed.ts`, `e2e/local-database.ts` (the X2 check, importable by Vitest), `e2e/feed.spec.ts`.
- `.github/workflows/e2e.yml`: `pull_request` and `workflow_dispatch`, a `postgres` service with a health check, Node from `.nvmrc`, `npx playwright install --with-deps chromium`, `npm run test:e2e`, and the Playwright report uploaded on failure.
- `.gitignore`: `playwright-report/` and `test-results/`.

## Risks / Trade-offs

- [Docker is needed locally] → Documented one-line command; `npm test` and CI-less development are unaffected.
- [Build step makes e2e slow to start] → Acceptable for a small suite that runs in CI and on demand, not on every `npm test`.
- [Scroll tests can be flaky] → Wait on the visible card count (`expect.poll` / web-first assertions) and on the loading marker, never on fixed timeouts.
- [Seed drifts from the schema] → The seed uses the Drizzle `claims` table definition, so a column change fails type checking.
- [The e2e step could be run against a wrong database] → X2 refuses non-local hosts before any write.
- [Browser tests duplicate lower-level ones] → The e2e suite stays small and covers only what needs a browser (X6).
