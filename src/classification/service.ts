import type { FilteredRecord } from "../pipeline/filter-entries";
import type { Classification, ClassificationStore, RatingClassifier } from "./types";
import { parseClassification } from "./validate";

/** Rating texts are cut to this many characters before they are cached or sent to the classifier (design D10). */
export const MAX_RATING_LENGTH = 300;

const UNCLASSIFIABLE: Classification = { category: "unclassifiable", severity: null };

export type ClassificationDeps = {
  classifier: RatingClassifier;
  store: ClassificationStore;
  /** Identifies the model and prompt; results from a different version are not reused. */
  classifierVersion: string;
};

export type ClassificationStats = {
  /** Distinct (truncated) rating texts in the run. */
  distinct: number;
  cached: number;
  classified: number;
  failed: number;
};

export const truncateRating = (ratingText: string): string => ratingText.slice(0, MAX_RATING_LENGTH);

/**
 * Classifies each distinct rating text once: from the cache when it is there, otherwise by the classifier.
 * A text that cannot be classified becomes unclassifiable for this run and is not cached, so a later run retries it.
 */
export async function classifyRatings(
  ratingTexts: Iterable<string>,
  { classifier, store, classifierVersion }: ClassificationDeps,
): Promise<{ classifications: Map<string, Classification>; stats: ClassificationStats }> {
  const distinct = [...new Set([...ratingTexts].map(truncateRating))];
  const classifications = await store.lookup(distinct, classifierVersion);
  const cached = classifications.size;

  const missing = distinct.filter((text) => !classifications.has(text));
  const answers = await askClassifier(classifier, missing);

  const learned: { ratingText: string; classification: Classification }[] = [];
  let failed = 0;
  missing.forEach((ratingText, index) => {
    const classification = answers[index] ?? null;
    if (classification === null) {
      failed++;
      classifications.set(ratingText, UNCLASSIFIABLE);
    } else {
      learned.push({ ratingText, classification });
      classifications.set(ratingText, classification);
    }
  });
  await store.save(learned, classifierVersion);

  return { classifications, stats: { distinct: distinct.length, cached, classified: learned.length, failed } };
}

/** One answer per text, in order; null for each text that has no valid answer. Never throws on classifier trouble. */
async function askClassifier(classifier: RatingClassifier, texts: string[]): Promise<(Classification | null)[]> {
  if (texts.length === 0) return [];
  try {
    const answers = await classifier.classify(texts);
    if (!Array.isArray(answers) || answers.length !== texts.length) return texts.map(() => null);
    return answers.map(parseClassification);
  } catch {
    return texts.map(() => null);
  }
}

export type ClassifiedRecord = FilteredRecord & Classification;

/** Adds a category and severity to each record, classifying each distinct rating text once. */
export async function classifyRecords(
  records: FilteredRecord[],
  deps: ClassificationDeps,
): Promise<{ records: ClassifiedRecord[]; stats: ClassificationStats }> {
  const { classifications, stats } = await classifyRatings(
    records.map((record) => record.ratingText),
    deps,
  );
  return {
    records: records.map((record) => ({ ...record, ...(classifications.get(truncateRating(record.ratingText)) ?? UNCLASSIFIABLE) })),
    stats,
  };
}
