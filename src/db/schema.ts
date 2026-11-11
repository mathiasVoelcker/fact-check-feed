import { date, integer, pgEnum, pgTable, real, text, timestamp } from "drizzle-orm/pg-core";

export const RATING_CATEGORIES = ["false", "misleading", "mixed", "true", "unproven", "unclassifiable"] as const;
export type RatingCategory = (typeof RATING_CATEGORIES)[number];

export const ratingCategory = pgEnum("rating_category", RATING_CATEGORIES);

/**
 * One row per fact-check. Only the permitted fields are stored: no article body and no other feed field.
 * `id` is a technical row identifier; `url` is the dedupe key (design D8).
 */
export const claims = pgTable("claims", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  url: text().notNull().unique(),
  claimText: text("claim_text").notNull(),
  ratingText: text("rating_text").notNull(),
  /** The publisher's explanation of the rating, capped (design E1); null when the feed gave none. */
  ratingExplanation: text("rating_explanation"),
  publisher: text().notNull(),
  publishedOn: date("published_on", { mode: "string" }).notNull(),
  sourceId: text("source_id").notNull(),
  category: ratingCategory().notNull(),
  severity: real(),
  ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Cache of the classifier's answer per distinct rating text. */
export const ratingClassifications = pgTable("rating_classifications", {
  id: integer().primaryKey().generatedAlwaysAsIdentity(),
  ratingText: text("rating_text").notNull().unique(),
  category: ratingCategory().notNull(),
  severity: real(),
  classifiedAt: timestamp("classified_at", { withTimezone: true }).notNull().defaultNow(),
  classifierVersion: text("classifier_version").notNull(),
});

export type Claim = typeof claims.$inferSelect;
export type NewClaim = typeof claims.$inferInsert;
export type RatingClassification = typeof ratingClassifications.$inferSelect;
export type NewRatingClassification = typeof ratingClassifications.$inferInsert;
