import type { RawReview } from "../sources/types";
import type { StageResult } from "./exclusions";

export const WINDOW_DAYS = 90;

const DAY_MS = 24 * 60 * 60 * 1000;

/** A review that has every required part. The publisher is kept exactly as the feed wrote it. */
export type RequiredFieldsReview = {
  claimText: string;
  ratingText: string;
  publisher: string;
  url: string;
  publishedDate?: string;
};

const isBlank = (value: string | undefined): value is undefined => value === undefined || value.trim() === "";

/** Checks the required parts in the order claim text, URL, publisher, rating text. The date is judged separately. */
export function requireFields(review: RawReview): StageResult<RequiredFieldsReview> {
  const { claimText, url, publisher, ratingText, publishedDate } = review;
  if (isBlank(claimText)) return { ok: false, reason: "missing-claim-text" };
  if (isBlank(url)) return { ok: false, reason: "missing-url" };
  if (isBlank(publisher)) return { ok: false, reason: "missing-publisher" };
  if (isBlank(ratingText)) return { ok: false, reason: "missing-rating-text" };
  return {
    ok: true,
    value: { claimText, ratingText, publisher, url, ...(publishedDate === undefined ? {} : { publishedDate }) },
  };
}

/** Days since the Unix epoch for a strict YYYY-MM-DD date, or null when it is not a real calendar date. */
function epochDay(isoDate: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return null;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])] as [number, number, number];
  const time = Date.UTC(year, month - 1, day);
  const date = new Date(time);
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return Math.floor(time / DAY_MS);
}

/** The oldest published date still inside the window for a run on `runDate` (both YYYY-MM-DD). */
export function windowStart(runDate: string): string {
  const run = epochDay(runDate);
  if (run === null) throw new Error(`Invalid run date: ${runDate}`);
  return new Date((run - WINDOW_DAYS) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Applies the date rules to the review's published date only (design D7; there is no fallback to any other date).
 * The date is the leading YYYY-MM-DD, optionally followed by a time. `runDate` is the UTC date the run started, as YYYY-MM-DD.
 */
export function checkDate(publishedDate: string | undefined, runDate: string): StageResult<{ publishedOn: string }> {
  const leading = publishedDate === undefined ? null : /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(publishedDate)?.[1];
  const published = leading ? epochDay(leading) : null;
  if (!leading || published === null) return { ok: false, reason: "invalid-date" };

  const run = epochDay(runDate);
  if (run === null) throw new Error(`Invalid run date: ${runDate}`);

  if (published > run) return { ok: false, reason: "future-date" };
  if (published < run - WINDOW_DAYS) return { ok: false, reason: "outside-window" };
  return { ok: true, value: { publishedOn: leading } };
}
