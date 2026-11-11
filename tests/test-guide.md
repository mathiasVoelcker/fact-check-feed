# Test guide

How to run the tests, what they cover, and what they deliberately do not touch. For the reasoning behind the strategy see decision D12 in `openspec/changes/archive/2026-11-07-ingest-data-commons-feed/design.md`.

## Running the tests

You need Node 24 (`nvm use 24`; the version is pinned in `.nvmrc`) and `npm install`. You do **not** need a database, Docker, a network connection or any API key.

```
npm test
```

This runs `vitest run` over `tests/**/*.test.ts`: about 22 files and 380 tests.

| Goal                         | Command                                                      |
| ---------------------------- | ------------------------------------------------------------ |
| Run one file                 | `npx vitest run tests/ingestion.test.ts`                     |
| Run tests matching a name    | `npx vitest run -t "idempotent"`                             |
| Watch mode (re-run on edits) | `npx vitest`                                                 |
| Typecheck (separate step)    | `npm run typecheck`                                          |
| Validate the specs           | `openspec validate ingest-data-commons-feed --strict`        |

The suite is limited to 2 workers and has generous timeouts (30 s per test, 60 s per hook; see `vitest.config.ts`). The memory test and the PGlite database tests make it slower than a typical unit suite, and on a heavily loaded machine it can look stuck for a long time. If that happens, close other heavy processes and run it again.

## What never happens in a test

- The live Data Commons feed is never requested. The download is replaced by a local stub server.
- No publisher site is contacted.
- The Gemini API is never called, and the real client is never constructed. A fake classifier stands in for it.
- No real Postgres is used. Tests run against [PGlite](https://pglite.dev), a Postgres engine that runs inside the test process, with the real migrations from `drizzle/` applied (see `tests/support/db.ts`). Production uses Neon; the SQL is the same.

## What the tests cover

| Area                 | Files                                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------- |
| Allowlist            | `allowlist`, `allowlist-guard`                                                                |
| Database schema      | `schema`                                                                                      |
| Data Commons adapter | `data-commons-adapter`, `data-commons-adapter-memory`, `data-commons-fetch`                   |
| Filters              | `filter-required-fields`, `filter-dates`, `filter-entries`, `explanation-cap`, `language`     |
| Classification       | `classification`, `gemini-classifier`                                                      |
| Whole pipeline       | `ingestion`, `rating-explanation`, `legal`, `cli`                                             |
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

`spec-coverage.test.ts` reads every `#### Scenario:` in the three specs, including the delta specs of changes still in progress, and checks that a test is mapped to it. It fails when:

- a scenario has no mapped test,
- a mapping names a scenario that no longer exists, or
- a mapped test has been renamed or removed.

When you add a scenario to a spec, add a line for it in that file's `COVERAGE` table. Also update the expected scenario count in the test. A scenario in an active change's delta spec counts as soon as it is written, and is counted once after the change is archived.

## Known gaps

- No automated test checks the model's judgment. The prompt was tried against the real model once, by hand, in the first live ingestion run (the answers are recorded in the fixture). The classifier tests replay those recorded answers, so they prove the plumbing (validation, caching, failure handling, and that only the rating text is sent). If the model or prompt changes, run a live ingestion and check the `rating_classifications` table.
- The GitHub Actions workflow file is tested only for its structure and the absence of secrets. It passes `actionlint` and has been run once on GitHub, but a scheduled run is not covered by any test.
- There are no browser tests (Playwright). They arrive with the UI change.
