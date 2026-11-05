import { describe, expect, it } from "vitest";
import {
  FIXTURE_RUN_DATE,
  type FixtureReview,
  isFixtureReview,
  loadFixtureItems,
} from "./support/fixture";

const DAY_MS = 24 * 60 * 60 * 1000;

const items = loadFixtureItems();
const reviews = items.filter(isFixtureReview);

function parseIsoDate(value: string | undefined): number | null {
  if (!value) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match.map(Number) as [number, number, number, number];
  const date = new Date(Date.UTC(y, m - 1, d));
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return date.getTime();
}

/** Days between the review date and the run date; positive means in the past. */
function ageInDays(review: FixtureReview): number | null {
  const published = parseIsoDate(review.datePublished);
  if (published === null) return null;
  return Math.round((Date.parse(FIXTURE_RUN_DATE) - published) / DAY_MS);
}

const rating = (review: FixtureReview) => review.reviewRating?.alternateName ?? "";

describe("claimreview-sample fixture", () => {
  it("is a small trimmed sample", () => {
    expect(items.length).toBeGreaterThanOrEqual(40);
    expect(items.length).toBeLessThanOrEqual(70);
  });

  it("contains a review with no published date", () => {
    expect(reviews.some((r) => !r.datePublished)).toBe(true);
  });

  it("contains a review with an invalid published date", () => {
    expect(reviews.some((r) => r.datePublished && parseIsoDate(r.datePublished) === null)).toBe(true);
  });

  it("contains an impossible calendar date that still looks like an ISO date", () => {
    expect(reviews.some((r) => r.datePublished === "2026-02-30")).toBe(true);
  });

  it("contains a future date, including one just after the run date", () => {
    expect(reviews.some((r) => (ageInDays(r) ?? 0) < 0)).toBe(true);
    expect(reviews.some((r) => ageInDays(r) === -1)).toBe(true);
  });

  it("contains a review dated on the run day", () => {
    expect(reviews.some((r) => ageInDays(r) === 0)).toBe(true);
  });

  it("contains reviews on the window boundary (day 89 and 90 in, day 91 out)", () => {
    for (const age of [89, 90, 91]) {
      expect(reviews.some((r) => ageInDays(r) === age), `no review ${age} days before the run date`).toBe(true);
    }
  });

  it("contains reviews far outside the window", () => {
    expect(reviews.some((r) => (ageInDays(r) ?? 0) > 150)).toBe(true);
  });

  it("contains non-English claims, including Persian, Sinhala and Tamil", () => {
    const claims = reviews.map((r) => r.claimReviewed ?? "");
    expect(claims.some((c) => /[؀-ۿ]/.test(c)), "Persian/Arabic script").toBe(true);
    expect(claims.some((c) => /[඀-෿]/.test(c)), "Sinhala script").toBe(true);
    expect(claims.some((c) => /[஀-௿]/.test(c)), "Tamil script").toBe(true);
  });

  it("contains English claims, short and long", () => {
    const english = reviews
      .map((r) => r.claimReviewed ?? "")
      .filter((c) => /^[\x20-\x7E‘-”–—… ]+$/.test(c) && /\b(the|is|of|and|in|to)\b/i.test(c));
    expect(english.some((c) => c.length < 60), "short English claim").toBe(true);
    expect(english.some((c) => c.length > 200), "long English claim").toBe(true);
  });

  it("contains reviews with missing claim text, URL and publisher", () => {
    expect(reviews.some((r) => !r.claimReviewed)).toBe(true);
    expect(reviews.some((r) => !r.url)).toBe(true);
    expect(reviews.some((r) => !r.author?.name)).toBe(true);
  });

  it("contains two reviews that share a URL", () => {
    const counts = new Map<string, number>();
    for (const r of reviews) if (r.url) counts.set(r.url, (counts.get(r.url) ?? 0) + 1);
    expect([...counts.values()].some((n) => n > 1)).toBe(true);
  });

  it("contains publisher names that differ only by a suffix", () => {
    const names = new Set(reviews.map((r) => r.author?.name).filter(Boolean) as string[]);
    expect(names.has("Fact Crescendo")).toBe(true);
    expect(names.has("Fact Crescendo Sri Lanka")).toBe(true);
  });

  it("contains a bilingual rating", () => {
    expect(reviews.some((r) => rating(r).includes(" / "))).toBe(true);
    expect(reviews.some((r) => rating(r) === "பொய் / False")).toBe(true);
  });

  it("contains a bilingual rating on an English claim", () => {
    const english = (c: string) => /^[\x20-\x7E‘-”]+$/.test(c);
    expect(reviews.some((r) => rating(r).includes(" / ") && english(r.claimReviewed ?? "") && !!r.claimReviewed)).toBe(true);
  });

  it("contains sentence ratings, with and without a stated verdict", () => {
    const sentences = reviews.filter((r) => rating(r).length > 40);
    expect(sentences.some((r) => /\b(false|misleading|true)\b/i.test(rating(r))), "verdict then explanation").toBe(true);
    expect(sentences.some((r) => !/\b(false|misleading|true|fake|unproven)\b/i.test(rating(r))), "no verdict").toBe(true);
  });

  it("contains an entry that is not a review at all", () => {
    expect(items.some((item) => !isFixtureReview(item))).toBe(true);
  });

  it("keeps the extra feed fields so the adapter can prove it ignores them", () => {
    expect(reviews.some((r) => "itemReviewed" in r)).toBe(true);
    expect(reviews.some((r) => "sdPublisher" in r)).toBe(true);
  });
});
