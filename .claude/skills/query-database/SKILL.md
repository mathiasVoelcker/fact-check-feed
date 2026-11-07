---
name: query-database
description: Query the project's Postgres database (Neon) read-only to inspect ingested fact-check claims and cached rating classifications. Use when the user asks what is in the database, how many claims or publishers there are, what a rating text was classified as, whether an ingestion run worked, or to check the data after `npm run ingest`.
---

# Query the project database

The database holds what `npm run ingest` stores. Production is Neon Postgres. Tests use an in-memory PGlite database and never touch it.

## How to run a query

From the project root, use Node 24 (`source ~/.nvm/nvm.sh; nvm use 24`; use `;` and not `&&` after `source`):

```
node --no-warnings --env-file-if-exists=.env .claude/skills/query-database/query.mjs "select count(*) from claims"
```

- Add `--json` for JSON output instead of a table.
- The script reads `DATABASE_URL` from `.env` and never prints it. `psql` is not installed, so use this script.
- It runs inside a read-only transaction, so writes fail. Do not look for a way around that. Changing data is a separate request and needs the user's go-ahead (for example by re-running `npm run ingest`, which is idempotent).
- Do not print, echo or inspect `DATABASE_URL` or any key value. If the permission system blocks a read of `.env`, ask the user rather than working around it.
- If `DATABASE_URL` is missing, tell the user to create `.env` from `.env.example`. `.env.local` is only read by Next.js, not by the scripts.
- The first connection to Neon can take a second (scale to zero).

## Tables

`claims`: one row per fact-check article.
- `id` (surrogate key), `url` (unique), `claim_text`, `rating_text`, `publisher`, `published_on` (date), `source_id`, `category`, `severity` (real, null when unclassifiable), `ingested_at`.
- Rows older than 90 days by `published_on` are removed by each run.

`rating_classifications`: the cache of the classifier's answers.
- `id`, `rating_text` (unique; truncated to 300 characters), `category`, `severity`, `classified_at`, `classifier_version` (for example `gemini:gemini-3.5-flash-lite:prompt-v1`).

`category` is one of `false`, `misleading`, `mixed`, `true`, `unproven`, `unclassifiable`. "Negative" means false or misleading; it is not a column.

There is no foreign key. `claims.rating_text` matches `rating_classifications.rating_text` by value.

## Useful queries

```sql
-- size and date range of the window
select count(*) claims, count(distinct publisher) publishers, min(published_on), max(published_on) from claims;

-- how many claims per category
select category, count(*) from claims group by 1 order by 2 desc;

-- what each rating text was classified as
select left(rating_text, 60) rating_text, category, severity, classifier_version from rating_classifications order by category, severity desc nulls last;

-- claims per publisher
select publisher, count(*) from claims group by 1 order by 2 desc;

-- claims that failed classification (they are retried on the next run)
select left(claim_text, 80) claim, rating_text, publisher from claims where category = 'unclassifiable';

-- a sample of the newest claims
select published_on, publisher, category, left(claim_text, 80) claim from claims order by published_on desc limit 10;

-- severity ranking: most negative first
select severity, category, left(claim_text, 80) claim from claims where severity is not null order by severity desc, published_on desc limit 10;
```

Keep result sets small (use `limit`), and do not paste large amounts of claim text into the conversation.

## Reading the results

- All claims `unclassifiable` and `rating_classifications` empty means classification failed in the last run, usually a bad or missing `GEMINI_API_KEY`. The ingestion report names how many texts failed.
- `ingested_at` is set on first insert and not touched by updates, so it shows when a claim first arrived, not when the last run happened.
- A different `classifier_version` than the one in `src/classification/gemini.ts` means those cached rows are stale and get re-classified on the next run.
