# Tasks

## 1. Project scaffolding

- [x] 1.1 Create the TypeScript project (Next.js app skeleton, strict TypeScript, Vitest, Drizzle, zod) with `npm test` running Vitest; verify `npm test` runs and passes with one placeholder test
- [x] 1.2 Add a `.gitignore` that excludes env files and downloaded feed files, and a `.env.example` listing `DATABASE_URL` and the LLM API key; verify no secret value is present in any committed file
- [x] 1.3 Add the test fixture `tests/fixtures/claimreview-sample.json` (about 50 reviews trimmed from the real feed, covering each exclusion reason in design D12) and `tests/fixtures/NOTICE.md` stating the data comes from Data Commons under CC BY 4.0; verify a test loads the fixture and asserts it contains every edge case (missing date, invalid date, future date, outside window, non-English, missing fields, duplicate URL, bilingual rating, sentence rating)

## 2. Source allowlist

- [x] 2.1 Write tests for allowlist loading (complete entry accepted, missing field rejected, unknown access method rejected, initial content is only the Data Commons feed) and verify they fail
- [x] 2.2 Implement the zod-validated allowlist config with the Data Commons ClaimReview entry (bulk, CC BY 4.0, attribution text from design D4, feed URL); verify the 2.1 tests pass
- [x] 2.3 Write tests that an unlisted source is refused before any network request and that a listed source is fetched by its recorded method, then implement the guard; verify the tests pass with the network stubbed to fail on any call

## 3. Database schema

- [x] 3.1 Write a test that the `claims` table has exactly the permitted feed columns (url, claim text, rating text, publisher, published date, source id, category, severity, ingested at) plus the technical surrogate `id` primary key and no others, that `rating_classifications` exists with its columns and an `id` primary key, and that `claims.url` and `rating_classifications.rating_text` carry unique constraints (inserting a duplicate fails); verify it fails
- [x] 3.2 Implement the Drizzle schema and the first migration (design D5); verify the 3.1 test passes against a test Postgres and that the migration applies to an empty database
- [x] 3.3 Document local setup (database, env vars, running migrations and tests) in `README.md`; verify a fresh clone can follow it to a passing test run

## 4. Data Commons adapter

- [x] 4.1 Write adapter contract tests over the fixture: maps claim text, rating text, publisher, date string and URL; ignores explanations, images and appearance links; tolerates entries with missing parts; verify they fail
- [x] 4.2 Implement the streaming parse of `dataFeedElement[].item[]` into `RawReview` values (design D3) behind the adapter interface; verify the 4.1 tests pass and that peak memory stays flat on a generated large input
- [x] 4.3 Write tests for the download step using a local stub server: success writes a temp file, a failed or non-JSON response fails the run before parsing, the request carries a descriptive user-agent, and the temp file is deleted afterward; verify they fail
- [x] 4.4 Implement `fetchSnapshot` to satisfy 4.3; verify the tests pass and that no test reaches the live feed URL

## 5. Filters and normalization

- [x] 5.1 Write unit tests for required fields (missing claim text, URL, publisher excluded with their own reasons) and for storing the publisher name unchanged; verify they fail
- [x] 5.2 Write unit tests for date rules: missing, unparseable and impossible dates excluded, future date rejected, run-day date accepted, no fallback to other dates, and the window boundaries (day 89 and 90 in, day 91 out); verify they fail
- [x] 5.3 Implement required-field and date/window filters with per-reason counters (design D6, D7); verify the 5.1 and 5.2 tests pass
- [x] 5.4 Build the labeled language fixture (real short and long claims, English and non-English, including Persian, Arabic and Sinhala) and write the accuracy test with a threshold; verify it fails
- [x] 5.5 Implement deterministic English detection (design D9), choosing the library and minimum text length by the fixture result; verify the 5.4 test passes, that repeated calls give identical results, and that no network call is made
- [x] 5.6 Write and satisfy tests for URL dedupe within a run (one record per URL, last one wins) and malformed entries counted and skipped; verify the tests pass

## 6. Rating classification

- [x] 6.1 Write tests with a fake classifier for: category and severity assignment, negative = false or misleading, unclassifiable has no severity, one classifier call per distinct text, cache reuse across runs, and failure handling (stored as unclassifiable, not cached, retried next run); verify they fail
- [x] 6.2 Write a test that the classifier request contains only the rating text (truncated to the maximum length) and no claim text, URL or publisher; verify it fails
- [x] 6.3 Implement the classifier interface, the cache backed by `rating_classifications`, and the failure handling; verify the 6.1 and 6.2 tests pass
- [x] 6.4 Implement the Gemini-backed classifier (first built on Anthropic, switched during apply, see design D10) with structured output validated by zod, and prompt-example tests using recorded responses for "False", "பொய் / False", a verdict-plus-explanation sentence, and a no-verdict sentence; verify the tests pass offline and that the real client is never constructed in tests
- [x] 6.5 Document the classifier's categories, severity meaning and how to change the model or prompt (including bumping the classifier version) in `docs/rating-classification.md`; verify the documented categories match the spec

## 7. Ingestion run

- [x] 7.1 Write the ingestion integration test against a test Postgres using the fixture: stored records match expectations, counts per exclusion reason are reported, re-running is idempotent, an existing URL updates in place, aged-out rows are removed, and a mid-run failure rolls everything back; verify it fails
- [x] 7.2 Write legal-rule tests: stored columns equal the permitted list, no request goes to any host other than the feed host, each stored record references its source and the attribution text is retrievable from the allowlist; verify they fail
- [x] 7.3 Implement the pipeline from design D1 (fetch, parse, filter, dedupe, classify, single-transaction upsert and cleanup, run report); verify the 7.1 and 7.2 tests pass
- [x] 7.4 Add the CLI entry point (`npm run ingest`) that runs the pipeline for the Data Commons source and prints the run report; verify running it against the local stub server produces the expected report and exits non-zero on failure
- [x] 7.5 Document the ADRs' revisit triggers (URL upsert key, language detection) and how to run an ingestion in `docs/ingestion.md`; verify the documented command runs as written

## 8. Scheduling

- [x] 8.1 Add the GitHub Actions workflow with a weekly cron and manual dispatch that runs `npm run ingest` using repository secrets and writes the run report to the workflow summary; verify the workflow file passes `actionlint` and contains no secret values
- [x] 8.2 Run the workflow once manually against the real feed and database; verify the run report shows plausible counts (about 300 English records in the window) and that the table contains no unexpected columns or article text

## 9. Integration check

- [x] 9.1 Run the full test suite and `openspec validate ingest-data-commons-feed --strict`; verify all tests pass and validation reports no errors
- [x] 9.2 Check each scenario in the three specs against a test that covers it; verify there is no scenario without a test

## Workflow follow-up

- Before archiving, confirm the Data Commons feed is recorded in the allowlist with access method bulk and license CC BY 4.0, as the project's archive guidance requires.
- Archive the change after review, then verify the new main specs `source-allowlist`, `claim-ingestion` and `rating-classification` exist.
