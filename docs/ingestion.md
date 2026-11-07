# Ingestion

A run downloads the full Google Data Commons ClaimReview snapshot (about 200 MB), keeps the recent English fact-checks,
classifies their ratings, and stores them in Postgres. It runs weekly from GitHub Actions and on demand.

## What a run does

```
allowlist check -> download snapshot to a temp file -> stream-parse it
   -> filters: required fields -> date -> 90-day window -> English
   -> keep one record per URL (the last one in the snapshot wins)
   -> classify each distinct rating text (cache first, then the model)
   -> one transaction: upsert records, delete records older than the window
   -> run report
```

- Only the claim text, rating text, publisher, review date and the link to the original fact-check are stored, plus
  the source reference and the derived category and severity. Article bodies are never stored, and no publisher site
  is ever contacted.
- The window is the 90 days up to and including the run date (UTC). Reviews with a missing or invalid date, or a date
  after the run date, are excluded.
- Classification is described in [rating-classification.md](rating-classification.md).

## Running it

Set up once (see the [README](../README.md)): copy `.env.example` to `.env` and fill in `DATABASE_URL` (Postgres) and
`GEMINI_API_KEY` (rating classification). Then apply the migrations and run:

```bash
npm run db:migrate
npm run ingest
```

`npm run ingest` prints the run report and exits 0 when the run completed, or exits 1 with the reason when it failed.
Under GitHub Actions it also appends the report to the workflow summary.

```
Ingestion run for data-commons-claimreview on 2026-11-02
  read: 54
  stored: 27
  removed (aged out of the window): 0
  excluded:
    malformed: 1
    missing-claim-text: 1
    ...
  rating texts: 12 distinct, 0 cached, 12 classified, failed 0
```

Every entry that was read ends up either stored or counted under exactly one exclusion reason, so
`read = stored + the sum of all excluded`. `duplicate-url` counts reviews replaced by a later review with the same URL.

### The weekly schedule

The workflow `.github/workflows/ingest.yml` runs `npm run ingest` every week and can be started by hand from the
Actions tab (manual dispatch). It needs the repository secrets `DATABASE_URL` and `GEMINI_API_KEY`; secrets are
never written to the repository.

### When something goes wrong

- **It is safe to re-run.** Running the same snapshot again changes nothing, and an existing URL is updated in place.
- **A failed run leaves the stored data unchanged.** Storing happens in one transaction, so a failure partway through is
  rolled back; a failed or truncated download fails before anything is processed.
- **Ratings that could not be classified** are stored as `unclassifiable` for this run, are not cached, and are retried
  by the next run. The report counts them and the run prints a warning.
- **A malformed entry in the snapshot** is counted under `malformed` and skipped; the rest of the run carries on.
- **The feed format changed.** If the snapshot contains no reviews at all (the structure is no longer a feed, or every entry is malformed), the run fails with an error and stores nothing, including no deletions.
- **A review whose URL is not an absolute http(s) link** is counted under `missing-url` and skipped.

## Decisions to revisit

These two decisions were accepted for the first version, with the signal that says when to look at them again. The
reasoning is in the change's `design.md` (D8 and D9).

### The article URL as the upsert key (D8)

The original fact-check URL identifies a stored record. Some articles review several claims under one URL
(multi-claim articles); only one of those claims is kept per URL, the last one in the snapshot.

**Revisit when** multi-claim articles turn out to be common. Watch the `duplicate-url` count in the run report against
`stored`: a visible share of the stored window, or users reporting missing claims, is the signal. The likely
replacement key is `(url, normalized claim text)`.

**How to change it:** the `id` column is the primary key, so only the unique constraint changes: replace the unique
constraint on `url` with one on the new key in `src/db/schema.ts`, run `npm run db:generate`, change the
`onConflictDoUpdate` target in `src/pipeline/run.ts`, and replace the URL dedupe in `src/pipeline/filter-entries.ts`
with the same key. The tests that mention the URL key (`tests/schema.test.ts`, `tests/filter-entries.test.ts`,
`tests/ingestion.test.ts`) say what to update.

### Deterministic English detection (D9)

A claim is English when at least 80% of its letters are Latin and either `franc-min` or `tinyld` identifies it as
English; undetermined claims are excluded, because a missed English claim is safer than a foreign one in an English
feed. Short claims are the weak spot.

**Revisit when** English claims are being dropped that should be kept, or foreign claims get through. Add the claims in
question, labeled, to `tests/fixtures/language-labeled.json` and run `tests/language.test.ts`: it reports which claims
were wrongly dropped or kept and holds the accuracy thresholds. Swap the library, change the minimum text length or
the Latin-script guard in `src/pipeline/language.ts` only if the labeled results improve.
