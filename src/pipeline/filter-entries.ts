import type { ParsedEntry } from "../sources/types";
import { type ExclusionCounts, countExclusion, createExclusionCounts } from "./exclusions";
import { MAX_EXPLANATION_LENGTH, MAX_ORIGIN_LABEL_LENGTH, capText } from "./cap";
import { checkDate, isHttpUrl, requireFields } from "./filters";
import { isEnglish as defaultIsEnglish } from "./language";

/** A review that passed every filter, ready to be classified and stored. */
export type FilteredRecord = {
  url: string;
  claimText: string;
  ratingText: string;
  publisher: string;
  publishedOn: string;
  /** The publisher's explanation of the rating, capped; absent when the feed gave none. */
  ratingExplanation?: string;
  /** Where the claim appeared, the fake news itself (design E7); only an absolute http(s) URL is kept. */
  originalUrl?: string;
  /** Venue and author of the original claim, capped; absent when the feed gave none. */
  originalVenue?: string;
  originalAuthor?: string;
};

export type FilterOptions = {
  /** The UTC date the run started, as YYYY-MM-DD. */
  runDate: string;
  isEnglish?: (claimText: string) => boolean;
};

export type FilterResult = {
  records: FilteredRecord[];
  /** Every entry read from the snapshot, malformed ones included. */
  read: number;
  counts: ExclusionCounts;
};

/**
 * Runs each entry through the filters in the order malformed, required fields, date and window, language,
 * then keeps one record per URL (the last one in the run wins). Every entry ends up kept or counted under one reason.
 */
export async function filterEntries(
  entries: AsyncIterable<ParsedEntry>,
  { runDate, isEnglish = defaultIsEnglish }: FilterOptions,
): Promise<FilterResult> {
  const counts = createExclusionCounts();
  const byUrl = new Map<string, FilteredRecord>();
  let read = 0;

  for await (const entry of entries) {
    read++;
    if (entry.kind === "malformed") {
      countExclusion(counts, "malformed");
      continue;
    }

    const required = requireFields(entry.review);
    if (!required.ok) {
      countExclusion(counts, required.reason);
      continue;
    }
    const { claimText, ratingText, publisher, url, publishedDate } = required.value;

    const date = checkDate(publishedDate, runDate);
    if (!date.ok) {
      countExclusion(counts, date.reason);
      continue;
    }

    if (!isEnglish(claimText)) {
      countExclusion(counts, "non-english");
      continue;
    }

    if (byUrl.delete(url)) countExclusion(counts, "duplicate-url");
    const { ratingExplanation, originalUrl, originalVenue, originalAuthor } = entry.review;
    byUrl.set(url, {
      url,
      claimText,
      ratingText,
      publisher,
      publishedOn: date.value.publishedOn,
      ...(ratingExplanation === undefined ? {} : { ratingExplanation: capText(ratingExplanation, MAX_EXPLANATION_LENGTH) }),
      ...(originalUrl === undefined || !isHttpUrl(originalUrl) ? {} : { originalUrl }),
      ...(originalVenue === undefined ? {} : { originalVenue: capText(originalVenue, MAX_ORIGIN_LABEL_LENGTH) }),
      ...(originalAuthor === undefined ? {} : { originalAuthor: capText(originalAuthor, MAX_ORIGIN_LABEL_LENGTH) }),
    });
  }

  return { records: [...byUrl.values()], read, counts };
}
