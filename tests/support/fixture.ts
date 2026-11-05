import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The run date every test that uses the fixture assumes. */
export const FIXTURE_RUN_DATE = "2026-11-02";

export type FixtureReview = {
  url?: string;
  claimReviewed?: string;
  datePublished?: string;
  author?: { name?: string };
  reviewRating?: { alternateName?: string };
  [key: string]: unknown;
};

export const FIXTURE_PATH = fileURLToPath(new URL("../fixtures/claimreview-sample.json", import.meta.url));

/** Every `item` of every feed element, exactly as it appears in the fixture (including malformed ones). */
export function loadFixtureItems(): unknown[] {
  const feed = JSON.parse(readFileSync(FIXTURE_PATH, "utf8")) as {
    dataFeedElement: { item: unknown[] }[];
  };
  return feed.dataFeedElement.flatMap((element) => element.item);
}

export function isFixtureReview(item: unknown): item is FixtureReview {
  return typeof item === "object" && item !== null && !Array.isArray(item);
}
