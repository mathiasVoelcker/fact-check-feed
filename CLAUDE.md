# Fact-check feed

A learning project built with spec-driven development (OpenSpec). A weekly job ingests recent fact-checks from the
Data Commons ClaimReview feed into Postgres (Neon); a web UI will read them later. Only the ingestion exists so far.

## Where to look

- `docs/architecture.md`: components, data model, one run step by step, where code lives, key decisions. Start here.
- `openspec/specs/`: what the system must do (the current specs). `openspec/config.yaml`: project constraints.
- `openspec/changes/archive/`: finished changes with their proposal, design (the ADRs) and tasks.
- `docs/ingestion.md`, `docs/rating-classification.md`: how to run it, and how the classifier works and is changed.
- `tests/test-guide.md`: how to run the tests and what they cover.

## Commands

Use Node 24: `source ~/.nvm/nvm.sh; nvm use 24` (use `;`, not `&&`, after `source`).

- `npm test` runs all tests (offline, no database, no API key needed). `npm run typecheck` checks types.
- `npm run db:migrate` and `npm run ingest` use `DATABASE_URL` and `GEMINI_API_KEY` from `.env`. Both act on the real
  Neon database, and `ingest` calls Gemini, so run them only when asked.
- To look at the database, use the `query-database` skill (read-only).
- `openspec validate <change> --strict` validates a change.

## Rules

- **Legal:** store only claim text, rating text, publisher, date and the link back, plus, when the feed has them, the publisher's rating explanation (capped at 1000 characters) and the claim's origin: original URL (http(s) only), venue and author name (capped at 200). Caps are in `src/pipeline/cap.ts`. Never store article text, never
  contact publisher sites, and fetch only sources on the allowlist (`src/allowlist/allowlist.ts`).
- **The original URL is fake news.** `original_url`, `original_venue` and `original_author` (the claim's own origin) are the false or misleading content itself. Any UI that shows them must label them in plain words as the fake news, never as a source or reference, next to the rating, with a link that does not look ordinary and has `rel="noopener noreferrer nofollow"`. Never fetch the original URL. Rationale: design E7 of the `store-claim-context` change.
- **The LLM sees only rating text**, never claims, URLs or publishers.
- **Secrets** live in `.env` (gitignored) and GitHub repository secrets. Never print, log or commit a key or
  `DATABASE_URL`.
- **Tests never hit the live feed, a publisher site, Gemini or Neon.** They use fixtures, a fake classifier and PGlite.
- Changing the model or prompt in `src/classification/gemini.ts`: bump `PROMPT_VERSION` if answers can change.
- Changing behavior the specs describe: update the spec first (an OpenSpec change), then the code and tests.
  `tests/spec-coverage.test.ts` fails if a spec scenario has no mapped test.
- Update `docs/architecture.md` when a change alters the structure.
