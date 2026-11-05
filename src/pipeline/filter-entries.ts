import type { ParsedEntry } from "../sources/types";
import { type ExclusionCounts, countExclusion, createExclusionCounts } from "./exclusions";
import { checkDate, requireFields } from "./filters";
import { isEnglish as defaultIsEnglish } from "./language";

/** A review that passed every filter, ready to be classified and stored. */
export type FilteredRecord = {
  url: string;
  claimText: string;
  ratingText: string;
  publisher: string;
  publishedOn: string;
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
    byUrl.set(url, { url, claimText, ratingText, publisher, publishedOn: date.value.publishedOn });
  }

  return { records: [...byUrl.values()], read, counts };
}
