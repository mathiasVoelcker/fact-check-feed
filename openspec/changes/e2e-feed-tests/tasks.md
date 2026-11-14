# Tasks

## 1. Playwright setup and the local-database guard (tests first)

- [x] 1.1 Write `tests/e2e-database-guard.test.ts` (Vitest, offline): a local URL (`localhost`, `127.0.0.1`, `[::1]`) is accepted, a Neon-style host, any other host and a missing or unparsable URL are refused with an error that never prints the URL; verify it fails before implementation
- [x] 1.2 Implement `e2e/local-database.ts` (design X2) and verify `npx vitest run tests/e2e-database-guard.test.ts` passes
- [x] 1.3 Add `@playwright/test` as a dev dependency, a `test:e2e` script, and `playwright-report/` and `test-results/` to `.gitignore`; verify `npx playwright --version` runs and `npm test` still passes (Vitest does not pick up `e2e/`)
- [x] 1.4 Add `playwright.config.ts` (Chromium only, one worker, `webServer` running `next build && next start -p 3100` with `E2E_DATABASE_URL` as `DATABASE_URL`, `reuseExistingServer` off, `globalSetup`); verify `npm run typecheck` passes

## 2. Test database and seed

- [x] 2.1 Document and run a local Postgres container (`docker run` with a throwaway password and port) and verify `psql` or a `pg` connect against `E2E_DATABASE_URL` succeeds
- [x] 2.2 Write `e2e/seed.ts` (design X4: 120 synthetic claims, fixed dates, all six categories, several publishers, origin on false, misleading and true claims, none on others, `.invalid` hosts) and verify `npm run typecheck` passes
- [x] 2.3 Write `e2e/global-setup.ts`: check the URL with the guard, apply the `drizzle/` migrations, truncate `claims` and `rating_classifications`, insert the seed; verify it runs against the container and leaves 120 rows (`npx playwright test --list` plus a count query)
- [x] 2.4 Add an offline Vitest check that every `claim-feed :: ...` title in `e2e/*.spec.ts` names a scenario in `openspec/specs/claim-feed/spec.md` (design X6); verify it fails for a made-up title and passes for the real ones

## 3. Feed tests in the browser

- [x] 3.1 Write the paging tests in `e2e/feed.spec.ts`: first page shows exactly 50 cards and the page says 120 match; scrolling to the end adds 50 then 20, shows no loading marker after the last page and no card twice; verify they pass against the built app
- [x] 3.2 Write the search and filter tests: a search narrows the list and the count, a category and publisher filter combine, changing a filter after loading several pages shows the first page of the new result, a search with no match shows the "No fact-checks match" state and "Clear the search and filters" restores the list; verify they pass
- [x] 3.3 Write the retry test (design X5): fail the next-page request, assert the "Could not load more" alert, restore the route, click "Try again" and assert the cards arrive with no duplicates; verify it passes
- [x] 3.4 Write the origin tests the project rules require: the false, misleading and true seeded claims show their wording ("the false claim itself", "the misleading claim itself", "the claim that was checked", each "not a source"), the true one never says false or misleading about the claim, the rating badge is on the same card, the original-claim link has `rel="noopener noreferrer nofollow"`, `target="_blank"` and shows the host with a warning marker, and a claim without origin has no origin block; verify they pass
- [x] 3.5 Write the no-request test (design X5): over a full scroll and a filter change, no request goes to a `.invalid` host or any host but the test server; verify it passes
- [x] 3.6 Run the suite three times in a row against a fresh container and verify it passes every time (flakiness check)

## 4. CI and docs

- [ ] 4.1 Add `.github/workflows/e2e.yml` (design X7: pull requests and manual dispatch, `postgres` service with a health check, Node from `.nvmrc`, Chromium install, `npm run test:e2e`, report uploaded on failure, no repository secrets used) and verify it passes `actionlint` and that a push of the branch runs it green on GitHub
- [x] 4.2 Update `tests/test-guide.md` (how to start the container and run `npm run test:e2e`, what e2e covers and what stays below the browser, remove the "no browser tests" gap and keep any gap that remains), `docs/architecture.md` (the "No browser tests yet" decision and the e2e files in "Where things live") and the README (the `test:e2e` command and `E2E_DATABASE_URL`, Docker needed for it only); verify `tests/docs.test.ts` passes
- [x] 4.3 Add `E2E_DATABASE_URL` to `.env.example` as a comment explaining it must be a local database; verify the guard refuses a Neon URL placed there
- [x] 4.4 Run `npm test`, `npm run typecheck`, `npm run test:e2e` and `openspec validate e2e-feed-tests --strict`, and verify all pass

## Workflow follow-up

- Archive the change after review, with no spec sync (no delta specs).
