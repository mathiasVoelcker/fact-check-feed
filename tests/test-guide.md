# Test guide

How to run the tests, what they cover, and what they deliberately do not touch. For the reasoning behind the strategy see decision D12 in `openspec/changes/archive/2026-11-07-ingest-data-commons-feed/design.md`.

## Running the tests

You need Node 24 (`nvm use 24`; the version is pinned in `.nvmrc`) and `npm install`. You do **not** need a database, Docker, a network connection or any API key. (The browser tests below are separate and do need Docker.)

```
npm test
```

This runs `vitest run` over `tests/**/*.test.ts`: about 30 files and 549 tests.

| Goal                         | Command                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| Run one file                 | `npx vitest run tests/ingestion.test.ts`                     |
| Run tests matching a name    | `npx vitest run -t "idempotent"`                             |
| Watch mode (re-run on edits) | `npx vitest`                                                 |
| Typecheck (separate step)    | `npm run typecheck`                                          |
| Validate the specs           | `openspec validate ingest-data-commons-feed --strict`        |

The suite is limited to 2 workers and has generous timeouts (30 s per test, 60 s per hook; see `vitest.config.ts`). The memory test and the PGlite database tests make it slower than a typical unit suite, and on a heavily loaded machine it can look stuck for a long time. If that happens, close other heavy processes and run it again.

## Test dashboard

`npm run test:dashboard` starts a local page at http://127.0.0.1:4010 (set `TEST_DASHBOARD_PORT` to change it). It lists every unit test file (`tests/`) and e2e spec (`e2e/`), grouped by area, and has buttons to run everything, one suite, one group or one file. Results (per test, with failure messages) are shown on the page and kept in `.test-dashboard/` (gitignored). Browser tests need the Postgres container from "Browser tests" below to be running; the dashboard uses `E2E_DATABASE_URL` from its environment, or the container's URL when it is not set. It listens on localhost only, runs only `vitest` and `playwright` on files it discovered itself, and does not load `.env`. Code: `scripts/test-dashboard/`.

## What never happens in a test

- The live Data Commons feed is never requested. The download is replaced by a local stub server.
- No publisher site is contacted.
- The Gemini API is never called, and the real client is never constructed. A fake classifier stands in for it.
- No real Postgres is used by `npm test`. Those tests run against [PGlite](https://pglite.dev), a Postgres engine that runs inside the test process, with the real migrations from `drizzle/` applied (see `tests/support/db.ts`). Production uses Neon; the SQL is the same. The browser tests use a real Postgres in a local container, never Neon (see below).

## What the tests cover

| Area                 | Files                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Allowlist            | `allowlist`, `allowlist-guard`                                                                |
| Database schema      | `schema`                                                                                      |
| Data Commons adapter | `data-commons-adapter`, `data-commons-adapter-memory`, `data-commons-fetch`                   |
| Filters              | `filter-required-fields`, `filter-dates`, `filter-entries`, `text-cap`, `language`          |
| Classification       | `classification`, `gemini-classifier`                                                      |
| Web feed             | `feed-query` (SQL on PGlite), `feed-route`, `feed-card` (rendered markup, origin label, links), `feed-scroll` (list reducer), `feed-page` (page text, source rules) |
| Whole pipeline       | `ingestion`, `rating-explanation`, `claim-origin`, `legal`, `cli`                             |
| Browser tests        | `e2e/feed.spec.ts` (Playwright, run with `npm run test:e2e`); offline checks for them: `e2e-database-guard`, `e2e-spec-titles` |
| Docs and workflow    | `docs`, `workflow`                                                                            |
| Spec coverage        | `spec-coverage`                                                                               |
| Setup checks         | `placeholder`, `fixtures`                                                                     |

File names are `<name>.test.ts`.

## Fixtures and support code

- `fixtures/claimreview-sample.json`: 54 reviews trimmed from the real feed, plus a few hand-made edge cases (missing URL, impossible date, and so on). `fixtures/NOTICE.md` explains which entries are derived. The data comes from Data Commons under CC BY 4.0.
- `fixtures/language-labeled.json`: 165 claims labeled English or not, used for the language-detection accuracy test.
- `fixtures/classifier-responses.json`: model answers for rating texts. Most were **recorded** from the real Gemini model (taken from the `rating_classifications` table after the first successful ingestion run); two are **hand-written** because those texts have not been in the ingested data. Each case has a `source` field saying which.
- `support/db.ts`: starts a fresh PGlite database with the migrations applied.
- `support/feed-server.ts`: the local stub server that replaces the live feed.
- `support/fixture.ts`, `support/ingestion.ts`: load the fixture and build a ready-to-use test harness for a whole run.

## The spec-coverage test

`spec-coverage.test.ts` reads every `#### Scenario:` in the four specs, including the delta specs of changes still in progress, and checks that a test is mapped to it. It fails when:

- a scenario has no mapped test,
- a mapping names a scenario that no longer exists, or
- a mapped test has been renamed or removed.

When you add a scenario to a spec, add a line for it in that file's `COVERAGE` table. Also update the expected scenario count in the test. A scenario in an active change's delta spec counts as soon as it is written, and is counted once after the change is archived.

## Browser tests (Playwright)

`npm run test:e2e` runs the feed in a real Chromium, against a production build (`next build` and `next start` on port 3100) and a real Postgres. The Next server is a separate process, so PGlite cannot serve it. Start a throwaway Postgres (`--rm` removes it when stopped; needs Docker), point `E2E_DATABASE_URL` at it and run:

```bash
docker run --rm -d --name feedcheck-e2e -e POSTGRES_USER=e2e -e POSTGRES_PASSWORD=e2e -e POSTGRES_DB=e2e -p 127.0.0.1:5433:5432 postgres:17
export E2E_DATABASE_URL=postgres://e2e:e2e@127.0.0.1:5433/e2e
npm run test:e2e
docker stop feedcheck-e2e   # when done
```

- **It never touches Neon.** `E2E_DATABASE_URL` is separate from `DATABASE_URL`, and `e2e/local-database.ts` refuses any host but `localhost`, `127.0.0.1` or `::1` before anything is written (`e2e-database-guard` tests it).
- **The data is synthetic.** `e2e/global-setup.ts` applies the real migrations, empties `claims` and `rating_classifications` and inserts the 120 claims of `e2e/seed.ts`. All hosts in it are `.invalid`, which can never resolve. The tests only read.
- **What it covers.** Only what needs a browser: the paging and count as the reader scrolls, search and filters restarting the list, the retry button, the card and the origin block as rendered (wording per category, link attributes), and that the browser requests no host but the test server. Each test whose title starts with `claim-feed :: ` names a scenario of the `claim-feed` spec; `e2e-spec-titles` fails when one does not exist. Scenarios that need no browser stay with the tests above. "New claim between pages" is only tested on PGlite.
- **In CI** `.github/workflows/e2e.yml` runs it on pull requests and on demand with a `postgres` service container. The report is uploaded when it fails.

## Known gaps

- No automated test checks the model's judgment. The prompt was tried against the real model once, by hand, in the first live ingestion run (the answers are recorded in the fixture). The classifier tests replay those recorded answers, so they prove the plumbing (validation, caching, failure handling, and that only the rating text is sent). If the model or prompt changes, run a live ingestion and check the `rating_classifications` table.
- The GitHub Actions workflow file is tested only for its structure and the absence of secrets. It passes `actionlint` and has been run once on GitHub, but a scheduled run is not covered by any test.
- Browser tests run Chromium only, with no visual checks, and not in `npm test`. The look of the page is checked by hand with `npm run dev`. The scroll rules themselves are also a pure reducer with its own tests (`feed-scroll`).
