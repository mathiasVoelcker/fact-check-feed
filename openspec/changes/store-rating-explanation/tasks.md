# Tasks

## 1. Adapter and neutral type

- [ ] 1.1 Write adapter tests over the fixture: a review with `reviewRating.ratingExplanation` maps it to `ratingExplanation`, a review without one and one with a blank one map to no value, and every other existing mapping is unchanged; also change the existing test "ignores explanations, images, appearance links and other extra fields" in `tests/data-commons-adapter.test.ts`, which now contradicts the spec (it must keep ignoring `reviewBody`, images and appearance links but no longer `ratingExplanation`); verify they fail
- [ ] 1.2 Add the optional `ratingExplanation` to `RawReview` (`src/sources/types.ts`) and map it in `mapReview` (`src/sources/data-commons/adapter.ts`) with the existing non-blank helper; verify the 1.1 tests pass and `npm run typecheck` is clean

## 2. Cap and filter output

- [ ] 2.1 Write unit tests for the cap function (1000 characters or fewer unchanged, 1001 characters cut at a word boundary with an ellipsis and at most 1000 in total, one long word with no spaces cut hard, surrogate pair not split) and for `filterEntries` (explanation carried onto the record, absent one does not exclude and does not change the counts, the last review wins for a duplicate URL including its lack of explanation); verify they fail
- [ ] 2.2 Implement the cap function and carry `ratingExplanation` on `FilteredRecord` in `src/pipeline/filter-entries.ts`; verify the 2.1 tests pass and the existing filter tests still pass

## 3. Schema and store

- [ ] 3.1 Update `tests/legal.test.ts` and `tests/schema.test.ts` so the permitted claims columns include `rating_explanation` (nullable), and add a schema test that a claim can be inserted without it; verify they fail
- [ ] 3.2 Add `ratingExplanation: text("rating_explanation")` to the `claims` table in `src/db/schema.ts` and generate the migration with `npm run db:generate`; verify the 3.1 tests pass and the migration applies to an empty PGlite database (the migration file adds one nullable column and nothing else)
- [ ] 3.3 Write ingestion tests over the fixture: a review with an explanation is stored with it, a review without one is stored with null, an over-long explanation (over 1000 characters, from a synthetic review added to the test input because no fixture explanation exceeds 570) is stored cut, re-running with a changed explanation replaces it, re-running without one clears it, the fake classifier receives rating texts only, and a repeated identical run is still a no-op; verify they fail
- [ ] 3.4 Pass the explanation through the insert and add it to the upsert `set` in `src/pipeline/run.ts`; verify the 3.3 tests pass and the full `npm test` is green

## 4. Spec coverage and docs

- [ ] 4.1 Map each new and changed scenario in `tests/spec-coverage.test.ts` to its tests (the modified "Only permitted fields are stored" keeps its legal tests; each new scenario maps to a test from groups 1 to 3); verify `npm test` passes, including the coverage test, and fails if a mapping is removed
- [ ] 4.2 Update the stored-fields rule in `CLAUDE.md`, the data model section and key decisions of `docs/architecture.md`, and any mention in `docs/ingestion.md` or `tests/test-guide.md`; verify `tests/docs.test.ts` still passes and that no doc says explanations are never stored
- [ ] 4.3 Run `openspec validate store-rating-explanation --strict`, `npm run typecheck` and `npm test`; verify all three pass

## Workflow follow-up

- On request, apply the migration with `npm run db:migrate` and run `npm run ingest` to fill explanations for the stored claims (touches Neon and Gemini).
- Archive the change after review, then confirm `openspec/specs/claim-ingestion/spec.md` carries the new requirement.
