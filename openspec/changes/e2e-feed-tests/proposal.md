# Proposal

## Why

The `feed-ui` change tested the feed without a browser (design U8): the query on PGlite, the route as a function, the card as rendered markup and the scroll rules as a pure reducer. What nobody checks is the real thing: the `IntersectionObserver` loading the next page, a filter change aborting a request in flight, the retry button, and the origin block as a browser shows it. Those are checked by hand with `npm run dev` today. The project rules also ask for a UI test of the origin label and `rel` attributes, and `openspec/config.yaml` names Playwright for e2e.

## What Changes

- Add Playwright browser tests for the feed under `e2e/`, separate from the Vitest tests in `tests/`.
- The tests run a production build of the Next app (`next build` and `next start`) against a real Postgres, not PGlite (a separate server process cannot reach PGlite) and never Neon. Locally this is a Docker container; in CI it is a `services: postgres` container.
- A global setup applies the real Drizzle migrations to that database and seeds a fixed set of claims: more than 50 (so there is a second page), several publishers and categories, with and without a claim origin and explanation.
- The tests cover the feed scenarios a browser is needed for: scrolling loads the next 50 and the count shows the total, a search or filter restarts the list, the retry button after a failed page request, the origin block wording per category and its link attributes, and that no request goes to an original-claim URL.
- A new `npm run test:e2e` script. `npm test` is unchanged: offline, no database, no browser.
- A separate GitHub Actions workflow runs the e2e tests on pull requests and on demand. It is not part of the weekly ingestion workflow.
- A safety check refuses to run the e2e setup against any database that is not local, so the tests can never touch Neon.
- Docs: `tests/test-guide.md` (how to run e2e, remove the "no browser tests" gap), `docs/architecture.md`, and the README.

Out of scope: visual regression, cross-browser runs (Chromium only), accessibility audits, testing ingestion in a browser, and any change to the feed's behavior, the specs or the stored data.

Sources and access methods: none touched. The tests read only the test database and the local Next server. The seeded original URLs point at addresses that are never requested; a test asserts that.

Legal impact: none new. Seed data is synthetic (written for the tests), not copied from the live feed, so no third-party claim text is added to the repository.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. This change tests behavior the `claim-feed` spec already defines and changes none of it. It opts out of delta specs (`skip_specs: true`) because it is tooling. The e2e tests are tied to the existing scenarios by title (design X6).

## Impact

- New: `playwright.config.ts`, `e2e/` (global setup, seed data, tests), `.github/workflows/e2e.yml`, a `test:e2e` script, `@playwright/test` as a dev dependency, and an offline Vitest check that e2e test titles name real `claim-feed` scenarios.
- No change to `app/`, `src/` or the schema, except what a test needs to find an element (existing `data-*` attributes are used; none are expected to be added).
- Needs Docker for local runs; `npm test` and `npm run typecheck` still need nothing.
- Config note: `.gitignore` gains Playwright output folders.
