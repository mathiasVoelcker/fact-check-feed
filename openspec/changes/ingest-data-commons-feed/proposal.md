# Proposal

## Why

The fact-check feed has no data yet. Every later feature (ranking, API, UI) needs a database of recent, English-language fact-checked claims with a usable rating severity. The Data Commons ClaimReview feed is the only candidate source with an explicit reuse license (CC BY 4.0 on the compilation), so it is the safe place to start. The Google Fact Check Tools API was ruled out because its terms prohibit building a database of returned content.

A look at the real feed (checked 2026-10-31, 100,413 reviews, about 200 MB) shows it is usable but messy: only 23 English reviews fall in the last 7 days and about 300 in the last 90, many records lack a valid `datePublished`, a few are dated in the future, there is no language field, and rating text is free-form and multilingual (sometimes a whole sentence). The ingestion has to handle all of this explicitly.

## What Changes

- Add a source allowlist that records, for each source, its access method, license and attribution requirement. It starts with one entry: the Data Commons ClaimReview feed (bulk, CC BY 4.0, attribution required).
- Add a weekly ingestion job that downloads the full feed snapshot, parses it, and upserts normalized records into Postgres. Only claim text, rating text, publisher, date and the link to the original fact-check are stored. Article bodies are never stored.
- Filter records during ingestion:
  - keep English only, detected from the claim text by a deterministic library (no LLM)
  - keep a rolling 90-day window by `datePublished`
  - reject future-dated records and exclude records without a valid `datePublished`
- Upsert by article URL. Several claims can share one URL, so only one survives; this is a known limitation recorded in the design as a decision to revisit.
- Classify each distinct rating text into a category and a severity with an LLM, with an "unclassifiable" outcome, and cache the result per rating string. The LLM is used for nothing else.
- Store publisher names exactly as they appear in the feed, with no canonicalization.

Out of scope (separate later changes or not planned):
- Ranking and the feed API
- The web UI and the attribution display on the site (this change only provides the data the UI needs)
- Google Fact Check Tools API, publisher RSS, Reporters' Lab
- Non-English claims, publisher-name canonicalization, publisher-count ranking signal
- Multi-claim handling for articles with several claims

## Sources and legal impact

- **Source touched:** Data Commons ClaimReview feed only (`https://storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json`), access method bulk download. No scraping and no calls to publisher sites.
- **License:** the compilation is CC BY 4.0, so attribution to Data Commons is required wherever the data is shown. The feed has no per-record `sdLicense`, so the allowlist entry is for the feed itself. The Data Commons pages do not give attribution wording; the exact wording is to be settled in the design.
- **Residual risk:** the Data Commons FAQ says each publisher may have its own terms for content on its own site. We reduce this by storing only the minimum fields and always linking back to the original fact-check.
- **Caching and storage:** the full 200 MB file is downloaded on each run and not kept; only the filtered records are stored. The feed is public and we send an honest user-agent.
- **LLM data flow:** rating text strings (not claims) are sent to an LLM provider for classification. This is a new external service that receives publisher-written text.

## Capabilities

### New Capabilities
- `source-allowlist`: the registry of permitted sources with access method, license and attribution requirement, and the rule that ingestion only reads from allowlisted sources.
- `claim-ingestion`: the weekly fetch of the Data Commons feed, the English, date-window and date-validity filters, the stored-field limits, and the idempotent upsert by article URL.
- `rating-classification`: turning free-form rating text into a category and severity, with caching per rating string and an "unclassifiable" outcome.

### Modified Capabilities

None. The project has no existing specs.

## Impact

- **Code:** greenfield. Adds a TypeScript project with a database schema (Drizzle/Postgres), a feed adapter behind a source interface, an ingestion script, and a rating classifier.
- **Infrastructure:** a Postgres database (Neon) and a weekly GitHub Actions cron; secrets for the database and the LLM provider live in CI, never in the repo.
- **Dependencies:** a language-detection library, a JSON streaming parser for the 200 MB file, zod, Drizzle, Vitest and an LLM client.
- **Tests:** adapter contract tests and ingestion tests use a small recorded fixture trimmed from the real feed. Automated tests never hit the live feed or a live LLM.
