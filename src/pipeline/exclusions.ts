/** Why a review was left out of the stored records. Each reason has its own counter in the run report. */
export const EXCLUSION_REASONS = [
  "malformed",
  "missing-claim-text",
  "missing-url",
  "missing-publisher",
  "missing-rating-text",
  "invalid-date",
  "future-date",
  "outside-window",
  "non-english",
  /** A review replaced by a later review with the same URL in the same run. */
  "duplicate-url",
] as const;

export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];
export type ExclusionCounts = Record<ExclusionReason, number>;

/** The outcome of one filter stage: the value moves on, or the review is excluded for a reason. */
export type StageResult<T> = { ok: true; value: T } | { ok: false; reason: ExclusionReason };

export function createExclusionCounts(): ExclusionCounts {
  return Object.fromEntries(EXCLUSION_REASONS.map((reason) => [reason, 0])) as ExclusionCounts;
}

export function countExclusion(counts: ExclusionCounts, reason: ExclusionReason): void {
  counts[reason]++;
}
