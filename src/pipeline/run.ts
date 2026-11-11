import { lt, sql } from "drizzle-orm";
import { type Allowlist, allowlist as defaultAllowlist } from "../allowlist/allowlist";
import { SourceNotAllowlistedError } from "../allowlist/guard";
import { classifyRecords, type ClassificationStats } from "../classification/service";
import { createClassificationStore } from "../classification/store";
import type { RatingClassifier } from "../classification/types";
import { claims } from "../db/schema";
import type { Database } from "../db/types";
import type { SourceAdapter } from "../sources/types";
import type { ExclusionCounts } from "./exclusions";
import { filterEntries } from "./filter-entries";
import { windowStart } from "./filters";

export type IngestionDeps = {
  adapter: SourceAdapter;
  classifier: RatingClassifier;
  /** Identifies the classifier's model and prompt; cached classifications from another version are redone. */
  classifierVersion: string;
  db: Database;
  allowlist?: Allowlist;
  /** The run's clock; the run date is its UTC date. */
  now?: () => Date;
  /** How many records go into one INSERT statement. */
  upsertChunkSize?: number;
};

export type RunReport = {
  sourceId: string;
  /** The UTC date the run started, YYYY-MM-DD. */
  runDate: string;
  /** Every entry read from the snapshot, malformed ones included. */
  read: number;
  /** Records inserted or updated. */
  stored: number;
  /** Previously stored records removed because they aged out of the window. */
  removed: number;
  excluded: ExclusionCounts;
  classification: ClassificationStats;
};

/**
 * One ingestion run (design D1): fetch the snapshot, filter, classify, then in a single transaction upsert the
 * qualifying records and remove the ones that aged out. Any failure leaves the stored records as they were.
 */
export async function runIngestion({
  adapter,
  classifier,
  classifierVersion,
  db,
  allowlist = defaultAllowlist,
  now = () => new Date(),
  upsertChunkSize = 500,
}: IngestionDeps): Promise<RunReport> {
  // Refuse before any request is made.
  if (!allowlist.has(adapter.sourceId)) throw new SourceNotAllowlistedError(adapter.sourceId);

  const runDate = now().toISOString().slice(0, 10);

  const snapshot = await adapter.fetchSnapshot();
  const filtered = await filterEntries(adapter.parse(snapshot), { runDate }).finally(() => adapter.deleteSnapshot(snapshot));

  // The slow, external part finishes before the transaction opens.
  const { records, stats } = await classifyRecords(filtered.records, {
    classifier,
    store: createClassificationStore(db),
    classifierVersion,
  });

  const cutoff = windowStart(runDate);
  const removed = await db.transaction(async (tx) => {
    for (let start = 0; start < records.length; start += upsertChunkSize) {
      await tx
        .insert(claims)
        .values(
          records.slice(start, start + upsertChunkSize).map((record) => ({
            url: record.url,
            claimText: record.claimText,
            ratingText: record.ratingText,
            ratingExplanation: record.ratingExplanation ?? null,
            publisher: record.publisher,
            publishedOn: record.publishedOn,
            sourceId: adapter.sourceId,
            category: record.category,
            severity: record.severity,
          })),
        )
        .onConflictDoUpdate({
          target: claims.url,
          // ingested_at is left alone: it records when the claim first arrived, which keeps a repeated run a no-op.
          set: {
            claimText: sql`excluded.claim_text`,
            ratingText: sql`excluded.rating_text`,
            // An explanation the feed no longer carries is cleared, not kept.
            ratingExplanation: sql`excluded.rating_explanation`,
            publisher: sql`excluded.publisher`,
            publishedOn: sql`excluded.published_on`,
            sourceId: sql`excluded.source_id`,
            category: sql`excluded.category`,
            severity: sql`excluded.severity`,
          },
        });
    }
    const deleted = await tx.delete(claims).where(lt(claims.publishedOn, cutoff)).returning({ id: claims.id });
    return deleted.length;
  });

  return {
    sourceId: adapter.sourceId,
    runDate,
    read: filtered.read,
    stored: records.length,
    removed,
    excluded: filtered.counts,
    classification: stats,
  };
}
