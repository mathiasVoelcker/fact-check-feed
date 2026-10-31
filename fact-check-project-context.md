# Fact-Check Project: Conversation Context

Date: 2026-10-26

## Goal
Start a web development project with AI, mainly for "academic" reasons: improve AI skills by building the whole architecture with AI, using spec-driven development and integration/autonomous tests. Low stakes. Constraint: must not break web scraping laws.

## Ideas considered
1. **Fake-news feed**: app that exposes news found to be fake or misleading. A weekly job collects top trending fake news into the app's own database. (**Preferred**)
2. **Volunteer dev job portal**: non-profit, unpaid positions for software developers, with a weekly search for postings and GitHub repos wanting help. A legitimate version could use the GitHub API ("good first issue" finder).

Other ideas with similar architecture: retracted scientific papers (Crossref / Retraction Watch), product recalls (government APIs), open-source good-first-issue finder.

## Decisions and preferences so far
- Prefer option 1.
- The Google Fact Check Tools API (https://developers.google.com/fact-check/tools/api) is considered limited and low on content.
- Open to other fact-check sources and to other site ideas with a similar architecture.
- The site would link to the original source, not copy content.
- Not ready to write the spec or start building yet ("let's not get ahead of ourselves").

## Data source research (web search, not fully verified)
**Best: Data Commons Fact Check feed**
- Google's open ClaimReview dataset. Reporters' Lab describes nearly 250k items from hundreds of organizations.
- Bulk download, so ingestion is download and diff, with no crawling.
- Compilation licensed CC BY (attribution required). Each record has an `sdLicense` field; publishers may set their own terms, so keep it per record.
- `url` field points to the original fact-check.
- https://datacommons.org/factcheck/download and https://datacommons.org/factcheck/faq

**Second: Reporters' Lab Fact-Check Insights**
- ClaimReview plus MediaReview (images/video), filtered to reputable organizations; JSON available.
- https://reporterslab.org/2024/06/20/what-exactly-is-the-fact-check-insights-dataset/

**Supplementary: publisher RSS feeds**
- PolitiFact RSS (https://politifact.com/truth-o-meter/rss), Snopes feed, AFP / DE FACTO standardized fact-check RSS format.
- No reuse terms found; check each publisher's ToS. Full Fact appears to restrict crawling, so skip unless it has an official API.

**Research datasets (not for a live feed)**: ClaimBuster (23,533 debate statements), FactSpan (Zenodo).

**Caveats**: download links and update cadence not confirmed live. Bulk-file freshness may be a problem for a "this week's top" feed, so RSS adapters may be needed.

## Legal guardrails (for the future spec)
- Store only claim text, rating, publisher, date and a link back; no article bodies.
- Check API/feed terms for attribution and caching rules.
- Prefer APIs, RSS and structured ClaimReview over HTML scraping; respect `robots.txt` and ToS, rate-limit, honest user-agent.
- Per-source allowlist recording access method (API / RSS / page).

## Architecture sketches
**Feed/dashboard version**
- Weekly ingestion job with source adapters behind one interface, normalized and deduplicated records.
- "Trending" ranking: number of publishers reviewing the same claim, recency, rating severity.
- Postgres or SQLite, backend API, web UI with filters and link-outs.
- Tests: adapter contract tests with recorded fixtures, ingestion integration test, Playwright e2e.

**Browser extension version (latest idea)**
- Manifest V3 (TypeScript) extension: content script extracts page text, identifies claims (LLM or heuristics), looks them up against fact-checks (Fact Check API `claims:search` plus own index from the Data Commons dump), shows matches with rating, publisher and link.
- Needs a backend proxy (`/check`) to keep API keys and the vector index private.
- Hard part: semantic matching (embeddings or LLM). A match means "a fact-checker reviewed a similar claim," not "this page is false."
- Privacy: send only extracted claims, not full pages; needs a privacy policy; Chrome Web Store scrutiny.
- Cost: user-triggered checks first, cache results.
- Playwright can load unpacked extensions for e2e tests.
- Hybrid: the weekly ingestion and DB serve both a minimal public feed and the extension.

## Spec-driven workflow idea
1. `SPEC.md` (goals, non-goals, data model, legal rules)
2. Acceptance criteria per feature
3. AI generates tests first, then implements until they pass
4. ADR log for decisions

## Open questions
- Feed/dashboard, extension, or hybrid?
- Stack preference (e.g. Next.js + TypeScript, or Python/FastAPI + frontend)?
- Verify Data Commons download format and update cadence.
- When to start the spec.
