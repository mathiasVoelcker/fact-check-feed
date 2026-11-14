# Proposal

## Why

The ingestion job fills the database with recent fact-checks, but nothing lets a person read them. The `prototype/feed-ui` branch answered "what should the feed look like?" (cards, table or grouped by week) and the owner picked the cards layout. This change turns that choice into the real feed page, reading the real database.

## What Changes

- A public feed page lists the stored fact-checks as cards, newest first, read from the database (not the prototype's static snapshot).
- Each card shows: the rating (badge from the category, plus the publisher's own rating text), the claim text, the publisher's rating explanation when there is one, the claim's origin (original URL, venue, author) when there is one, the publisher, the date, and the link to the full fact-check.
- The origin is shown as the claim as it was posted, never as a source. The label no longer says "fake news (rated false)" for every card: its wording follows the rating category, so a claim rated true is never called false (design U3). This applies the rule of design E7 of `store-claim-context`.
- Cards load as the reader scrolls (50 at a time), and the "N shown" count is the true number of matching fact-checks.
- A search box and rating and publisher filters narrow the list. The prototype's "sort by newest / most severe" control is **removed** for now, because there is no settled rating classification to rank by; the order is the date, newest first.
- The page shows the attribution required by the Data Commons license, taken from the allowlist entry.
- The prototype (`app/prototype-feed/`, its snapshot and the table, grouped and variant-bar code) is deleted.
- Styling is kept deliberately plain and readable; a separate later change owns visual design.

Out of scope: visual design, ranking by recency or severity, sorting controls, a detail page, accounts, any change to ingestion or to the stored data, the Table and Grouped layouts, and browser (Playwright) tests (see design U8).

Sources and access methods: none touched. The feed reads only our own database. The UI never contacts publisher sites or the original-claim URLs, which are rendered only as links the reader may choose to follow.

Legal impact: the page republishes stored fields only (claim text, rating text, explanation capped at 1000 characters, origin fields, publisher, date, link back). It must show the CC BY 4.0 attribution and must present `original_url`, `original_venue` and `original_author` as the claim being checked, with the label, `rel` attributes and non-ordinary link style required by E7.

## Capabilities

### New Capabilities
- `claim-feed`: what the feed page shows for each stored claim, how the origin is labeled, how the list is ordered, paginated, searched and filtered, and which attribution it carries.

### Modified Capabilities

None. The stored data and ingestion behavior do not change.

## Impact

- New code: the feed page and its pieces under `app/`, a read-only claims query module under `src/feed/`, a small route that serves further pages of cards.
- Removed code: `app/prototype-feed/`. `app/page.tsx` becomes the feed.
- Reads `DATABASE_URL` on the server only. No new dependency is expected; no schema change or migration.
- Docs: `docs/architecture.md` (new component and where it lives), `tests/test-guide.md`, `CLAUDE.md` pointers if needed.
- Tests: vitest with PGlite for the query, server-rendered markup tests for the card and label, spec-coverage mapping for the new scenarios.
- Config note: `openspec/config.yaml` still says the design should rank by recency and severity. This change defers ranking on purpose (owner decision); the config rule is left unchanged for the later ranking change.
