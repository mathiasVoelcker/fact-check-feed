import type { RatingCategory } from "../db/schema";

/** A rating text's category and severity. Severity is 0 to 1, higher for more negative verdicts; null when unclassifiable. */
export type Classification = {
  category: RatingCategory;
  severity: number | null;
};

/**
 * Classifies rating texts. It is given the distinct rating text only, never a claim, URL or publisher.
 * It returns one entry per text, in order; `null` means that text could not be classified.
 * It may also throw, which fails every text in the request.
 */
export interface RatingClassifier {
  classify(ratingTexts: string[]): Promise<(Classification | null)[]>;
}

/** Persistent cache of classifications, keyed by (truncated) rating text. */
export interface ClassificationStore {
  /** Results stored for these texts by the given classifier version; other versions are treated as absent. */
  lookup(ratingTexts: string[], classifierVersion: string): Promise<Map<string, Classification>>;
  /** Stores results, replacing any row for the same text. */
  save(entries: { ratingText: string; classification: Classification }[], classifierVersion: string): Promise<void>;
}
