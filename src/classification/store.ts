import { and, eq, inArray, sql } from "drizzle-orm";
import { ratingClassifications } from "../db/schema";
import type { Database } from "../db/types";
import type { ClassificationStore } from "./types";

/** The `rating_classifications` table as a cache of classifier answers. */
export function createClassificationStore(db: Database): ClassificationStore {
  return {
    async lookup(ratingTexts, classifierVersion) {
      const found = new Map<string, { category: (typeof ratingClassifications.$inferSelect)["category"]; severity: number | null }>();
      if (ratingTexts.length === 0) return found;
      const rows = await db
        .select()
        .from(ratingClassifications)
        .where(and(inArray(ratingClassifications.ratingText, ratingTexts), eq(ratingClassifications.classifierVersion, classifierVersion)));
      for (const row of rows) found.set(row.ratingText, { category: row.category, severity: row.severity });
      return found;
    },

    async save(entries, classifierVersion) {
      if (entries.length === 0) return;
      await db
        .insert(ratingClassifications)
        .values(
          entries.map(({ ratingText, classification }) => ({
            ratingText,
            category: classification.category,
            severity: classification.severity,
            classifierVersion,
          })),
        )
        .onConflictDoUpdate({
          target: ratingClassifications.ratingText,
          set: {
            category: sql`excluded.category`,
            severity: sql`excluded.severity`,
            classifierVersion: sql`excluded.classifier_version`,
            classifiedAt: sql`now()`,
          },
        });
    },
  };
}
