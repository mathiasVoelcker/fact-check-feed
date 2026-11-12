# Tasks

## 1. Adapter and neutral type

- [x] 1.1 Write adapter tests over the fixture: a review with `reviewRating.ratingExplanation` maps it to `ratingExplanation`, a review without one and one with a blank one map to no value, and every other existing mapping is unchanged; also change the existing test "ignores explanations, images, appearance links and other extra fields" in `tests/data-commons-adapter.test.ts`, which now contradicts the spec (it must keep ignoring `reviewBody`, images and appearance links but no longer `ratingExplanation`); verify they fail
- [x] 1.2 Add the optional `ratingExplanation` to `RawReview` (`src/sources/types.ts`) and map it in `mapReview` (`src/sources/data-commons/adapter.ts`) with the existing non-blank helper; verify the 1.1 tests pass and `npm run typecheck` is clean

## 2. Cap and filter output

- [x] 2.1 Write unit tests for the cap function (1000 characters or fewer unchanged, 1001 characters cut at a word boundary with an ellipsis and at most 1000 in total, one long word with no spaces cut hard, surrogate pair not split) and for `filterEntries` (explanation carried onto the record, absent one does not exclude and does not change the counts, the last review wins for a duplicate URL including its lack of explanation); verify they fail
- [x] 2.2 Implement the cap function and carry `ratingExplanation` on `FilteredRecord` in `src/pipeline/filter-entries.ts`; verify the 2.1 tests pass and the existing filter tests still pass

## 3. Schema and store

- [x] 3.1 Update `tests/legal.test.ts` and `tests/schema.test.ts` so the permitted claims columns include `rating_explanation` (nullable), and add a schema test that a claim can be inserted without it; verify they fail
- [x] 3.2 Add `ratingExplanation: text("rating_explanation")` to the `claims` table in `src/db/schema.ts` and generate the migration with `npm run db:generate`; verify the 3.1 tests pass and the migration applies to an empty PGlite database (the migration file adds one nullable column and nothing else)
- [x] 3.3 Write ingestion tests over the fixture: a review with an explanation is stored with it, a review without one is stored with null, an over-long explanation (over 1000 characters, from a synthetic review added to the test input because no fixture explanation exceeds 570) is stored cut, re-running with a changed explanation replaces it, re-running without one clears it, the fake classifier receives rating texts only, and a repeated identical run is still a no-op; verify they fail
- [x] 3.4 Pass the explanation through the insert and add it to the upsert `set` in `src/pipeline/run.ts`; verify the 3.3 tests pass and the full `npm test` is green

## 4. Spec coverage and docs

- [x] 4.1 Map each new and changed scenario in `tests/spec-coverage.test.ts` to its tests (the modified "Only permitted fields are stored" keeps its legal tests; each new scenario maps to a test from groups 1 to 3); verify `npm test` passes, including the coverage test, and fails if a mapping is removed
- [x] 4.2 Update the stored-fields rule in `CLAUDE.md`, the data model section and key decisions of `docs/architecture.md`, and any mention in `docs/ingestion.md` or `tests/test-guide.md`; verify `tests/docs.test.ts` still passes and that no doc says explanations are never stored
- [x] 4.3 Run `openspec validate store-claim-context --strict`, `npm run typecheck` and `npm test`; verify all three pass

## 5. Claim origin: original URL, venue and author (added after groups 1 to 4 were built)

- [x] 5.1 Write adapter tests over the fixture and small hand-made feeds: `itemReviewed.firstAppearance.url` is preferred over `appearance`; with only `appearance` (a list, or a single object) the first listed URL is used; `itemReviewed.name` and `itemReviewed.author.name` map to `originalVenue` and `originalAuthor`; missing, blank and non-string values map to nothing; the fixture has the origin URL on 41 of 54 reviews; every other mapping is unchanged; extend the existing "returns exactly the neutral fields" test with the new optional keys; verify they fail
- [x] 5.2 Add the optional `originalUrl`, `originalVenue` and `originalAuthor` to `RawReview` and map them in `mapReview` (`src/sources/types.ts`, `src/sources/data-commons/adapter.ts`), keeping `reviewBody`, images and further appearance links ignored; verify the 5.1 tests pass and `npm run typecheck` is clean
- [x] 5.3 Write unit and filter tests: the cap function takes a limit (venue and author cut at 200 with an ellipsis at a word boundary, the explanation still at 1000); an original URL that is not an absolute http(s) URL (`javascript:`, relative, empty) is dropped without excluding the review and without changing the counts; the origin fields are carried onto the record; the last review for a URL wins including its lack of origin values; verify they fail
- [x] 5.4 Generalize the cap function in `src/pipeline/explanation.ts` to take its limit (rename it to something neutral, for example `capText`, and update its callers and the existing cap test), cap venue and author at 200, validate the original URL with the existing http(s) check, and carry the three fields on `FilteredRecord` in `src/pipeline/filter-entries.ts`; verify the 5.3 tests and the existing filter and cap tests pass
- [x] 5.5 Update `tests/legal.test.ts` and `tests/schema.test.ts` so the permitted claims columns include `original_url`, `original_venue` and `original_author` (nullable), and add a schema test that a claim can be inserted without them; verify they fail
- [x] 5.6 Add `originalUrl`, `originalVenue` and `originalAuthor` to the `claims` table in `src/db/schema.ts` and generate the migration with `npm run db:generate` as a new file (`0002`; do not edit `0001`, it is applied); verify the 5.5 tests pass and the migration adds only those three nullable columns
- [x] 5.7 Write ingestion tests over the fixture and a hand-made feed: the origin values of reviews that carry them are stored and the others are null; a review without any is not excluded; a stored value is replaced on a re-run and cleared when the feed no longer has it; a long venue or author is stored cut; a run requests no host other than the feed host while storing original URLs; the fake classifier receives rating texts only; verify they fail
- [x] 5.8 Pass the three fields through the insert and add them to the upsert `set` in `src/pipeline/run.ts`; verify the 5.7 tests pass and the full `npm test` is green
- [x] 5.9 Map each new scenario in `tests/spec-coverage.test.ts` (9 new: 6 under "Original-claim URL is optional and never requested", 3 under "Original claim venue and author are optional and capped") and update the expected scenario count (53 to 62); verify `npm test` passes and fails when a mapping is removed
- [x] 5.10 Update the stored-fields rule and data model in `CLAUDE.md`, `README.md`, `docs/architecture.md` (ER diagram, run steps, key decisions) and `docs/ingestion.md`, plus `tests/test-guide.md` (file list and counts); the UI rule (E7) is already in `CLAUDE.md`, `docs/architecture.md` and `openspec/config.yaml`, so verify it is still there and that `tests/docs.test.ts` passes
- [x] 5.11 Run `openspec validate store-claim-context --strict`, `npm run typecheck` and `npm test`; verify all three pass

## Workflow follow-up

- On request, apply the new migration (`0002`) with `npm run db:migrate` and run `npm run ingest` to fill the origin values and any missing explanations for the stored claims (touches Neon and Gemini).
- Archive the change after review, then confirm `openspec/specs/claim-ingestion/spec.md` carries the new requirement.
