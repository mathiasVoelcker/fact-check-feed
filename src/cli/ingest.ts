import { appendFile } from "node:fs/promises";
import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { createGeminiClassifierFromEnv, GEMINI_CLASSIFIER_VERSION } from "../classification/gemini";
import * as schema from "../db/schema";
import { type IngestionDeps, type RunReport, runIngestion } from "../pipeline/run";
import { dataCommonsAdapter } from "../sources/data-commons/adapter";

export type CliIo = {
  log(line: string): void;
  error(line: string): void;
};

/** Plain-text run report: what was read, stored, removed, and excluded per reason. */
export function formatReport(report: RunReport): string {
  const { classification } = report;
  return [
    `Ingestion run for ${report.sourceId} on ${report.runDate}`,
    `  read: ${report.read}`,
    `  stored: ${report.stored}`,
    `  removed (aged out of the window): ${report.removed}`,
    "  excluded:",
    ...Object.entries(report.excluded).map(([reason, count]) => `    ${reason}: ${count}`),
    `  rating texts: ${classification.distinct} distinct, ${classification.cached} cached, ${classification.classified} classified, failed ${classification.failed}`,
  ].join("\n");
}

/** The same report as Markdown, for the GitHub Actions workflow summary. */
export function formatMarkdown(report: RunReport): string {
  const { classification } = report;
  const row = (name: string, value: number | string) => `| ${name} | ${value} |`;
  return [
    `## Ingestion report: ${report.sourceId}`,
    "",
    `Run date: ${report.runDate}`,
    "",
    "| metric | count |",
    "| --- | --- |",
    row("read", report.read),
    row("stored", report.stored),
    row("removed", report.removed),
    ...Object.entries(report.excluded).map(([reason, count]) => row(reason, count)),
    row("rating texts (distinct)", classification.distinct),
    row("rating texts cached", classification.cached),
    row("rating texts classified", classification.classified),
    row("rating texts failed", classification.failed),
    "",
  ].join("\n");
}

/**
 * Runs one ingestion from the environment and reports the result. Returns the process exit code: 0 when the run
 * completed, 1 when it failed. `deps` replaces the database, source and classifier (used by tests).
 */
export async function runCli(env: Record<string, string | undefined>, io: CliIo, deps: Partial<IngestionDeps> = {}): Promise<number> {
  let pool: pg.Pool | undefined;
  try {
    let db = deps.db;
    if (!db) {
      if (!env.DATABASE_URL) throw new Error("DATABASE_URL is not set. Put it in .env (see .env.example) or the environment.");
      pool = new pg.Pool({ connectionString: env.DATABASE_URL });
      db = drizzle(pool, { schema });
    }

    const report = await runIngestion({
      adapter: dataCommonsAdapter,
      classifier: deps.classifier ?? createGeminiClassifierFromEnv(),
      classifierVersion: GEMINI_CLASSIFIER_VERSION,
      ...deps,
      db,
    });

    io.log(formatReport(report));
    if (report.classification.failed > 0) {
      io.log(
        `WARNING: classification failed for ${report.classification.failed} rating text(s); their records are stored as unclassifiable and will be retried next run.`,
      );
    }
    if (env.GITHUB_STEP_SUMMARY) await appendFile(env.GITHUB_STEP_SUMMARY, `${formatMarkdown(report)}\n`);
    return 0;
  } catch (error) {
    io.error(`Ingestion failed: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await pool?.end();
  }
}
