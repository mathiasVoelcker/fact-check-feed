import { createReadStream } from "node:fs";
import chain from "stream-chain";
import { parser } from "stream-json";
import pick from "stream-json/filters/pick.js";
import streamArray from "stream-json/streamers/stream-array.js";
import { type Allowlist, allowlist as defaultAllowlist } from "../../allowlist/allowlist";
import { fetchAllowlistedSource } from "../../allowlist/guard";
import type { ParsedEntry, RawReview, SourceAdapter } from "../types";
import { deleteSnapshot, downloadSnapshot } from "./snapshot";

export { deleteSnapshot };

export const DATA_COMMONS_SOURCE_ID = "data-commons-claimreview";

/** Sent with every request so the feed's operator can tell who is downloading it. */
export const USER_AGENT = "fact-check-feed/0.1 (learning project; weekly Data Commons ClaimReview ingestion)";

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A non-blank string is kept exactly as written; anything else counts as missing. */
function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() !== "" ? value : undefined;
}

function mapReview(item: Json): RawReview {
  const author = isObject(item.author) ? item.author : undefined;
  const rating = isObject(item.reviewRating) ? item.reviewRating : undefined;
  const fields = {
    claimText: text(item.claimReviewed),
    ratingText: text(rating?.alternateName),
    ratingExplanation: text(rating?.ratingExplanation),
    publisher: text(author?.name),
    publishedDate: text(item.datePublished),
    url: text(item.url),
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined)) as RawReview;
}

async function* parseSnapshot(path: string): AsyncGenerator<ParsedEntry> {
  const elements = chain([createReadStream(path), parser(), pick({ filter: "dataFeedElement" }), streamArray()]);
  let reviewCount = 0;
  for await (const { value } of elements as AsyncIterable<{ value: unknown }>) {
    const items = isObject(value) ? value.item : undefined;
    if (!Array.isArray(items)) {
      yield { kind: "malformed" };
      continue;
    }
    for (const item of items) {
      if (!isObject(item)) {
        yield { kind: "malformed" };
        continue;
      }
      reviewCount++;
      yield { kind: "review", review: mapReview(item) };
    }
  }
  // A feed without a single review (a changed structure, for example) must fail the run, not store nothing.
  if (reviewCount === 0) throw new Error("Not a valid feed: no reviews found in dataFeedElement[].item[]");
}

export type DataCommonsAdapterOptions = {
  allowlist?: Allowlist;
  userAgent?: string;
  tmpDir?: string;
};

export function createDataCommonsAdapter({
  allowlist = defaultAllowlist,
  userAgent = USER_AGENT,
  tmpDir,
}: DataCommonsAdapterOptions = {}): SourceAdapter {
  return {
    sourceId: DATA_COMMONS_SOURCE_ID,
    fetchSnapshot: () =>
      fetchAllowlistedSource(
        DATA_COMMONS_SOURCE_ID,
        { bulk: (entry) => downloadSnapshot(entry.url, { userAgent, tmpDir }) },
        allowlist,
      ),
    parse: parseSnapshot,
    deleteSnapshot,
  };
}

export const dataCommonsAdapter = createDataCommonsAdapter();
