/**
 * A review reduced to the neutral shape the pipeline works on. Every part may be missing:
 * judging missing parts is the pipeline's job, not the adapter's.
 */
export type RawReview = {
  claimText?: string;
  ratingText?: string;
  publisher?: string;
  /** The published date exactly as the source wrote it; it is parsed and validated downstream. */
  publishedDate?: string;
  url?: string;
};

/** What an adapter yields per feed entry; a malformed entry is counted by the pipeline and skipped. */
export type ParsedEntry = { kind: "review"; review: RawReview } | { kind: "malformed" };

export interface SourceAdapter {
  /** Identifier of the allowlist entry this adapter reads. */
  readonly sourceId: string;
  /** Downloads the full snapshot to a temporary file and returns its path. */
  fetchSnapshot(): Promise<string>;
  /** Streams the snapshot file, mapping each entry to a `ParsedEntry`. */
  parse(path: string): AsyncIterable<ParsedEntry>;
  /** Removes a snapshot returned by `fetchSnapshot`. */
  deleteSnapshot(path: string): Promise<void>;
}
