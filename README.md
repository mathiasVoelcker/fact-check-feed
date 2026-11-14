# Fact-check feed

A weekly job ingests recent fact-checked claims from the Google Data Commons ClaimReview feed into Postgres. A web feed
page (`npm run dev`, needs `DATABASE_URL`) lists them. Only claim text, rating text, publisher, date and a link to the original fact-check are
stored, plus, when the feed has them, the publisher's explanation of the rating (capped at 1000 characters) and where the
claim appeared: the original URL, venue and author name. That original claim is the fake news itself, never a source.

## Requirements

- Node 24 or newer (`nvm use` reads `.nvmrc`)
- A Postgres database for running migrations and ingestion (Neon in production). Tests do not need one.

## Setup

```bash
nvm use
npm install
cp .env.example .env   # then fill in the values below; .env is git-ignored
```

| Variable            | Used for                                                          |
| ------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`      | Postgres connection string for migrations and ingestion           |
| `GEMINI_API_KEY`    | Classifying rating text during ingestion (never needed by tests)  |

## Tests

```bash
npm test            # Vitest, fully offline
npm run typecheck   # TypeScript, strict mode
```

Tests run against [PGlite](https://pglite.dev), a real Postgres engine that runs inside the test process, so no
database, Docker or network is needed. They use a recorded fixture (`tests/fixtures/`) and never request the live feed.

## Database

The schema lives in `src/db/schema.ts` and the SQL migrations in `drizzle/`.

```bash
npm run db:generate   # after editing the schema: write a new migration into drizzle/
npm run db:migrate    # apply pending migrations to the database in DATABASE_URL
```

## Data and attribution

Fact-check data comes from Google Data Commons (datacommons.org/factcheck) and is licensed CC BY 4.0. Every stored
record carries its `source_id`; the attribution text for it is kept in `src/allowlist/allowlist.ts`.
