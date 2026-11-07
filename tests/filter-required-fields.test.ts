import { describe, expect, it } from "vitest";
import { createExclusionCounts, countExclusion } from "../src/pipeline/exclusions";
import { requireFields } from "../src/pipeline/filters";
import type { RawReview } from "../src/sources/types";

const complete: RawReview = {
  claimText: "A claim",
  ratingText: "False",
  publisher: "Example Checker",
  publishedDate: "2026-10-30",
  url: "https://example.org/check/1",
};

describe("required fields", () => {
  it("accepts a review that has every required field", () => {
    expect(requireFields(complete)).toEqual({
      ok: true,
      value: {
        claimText: "A claim",
        ratingText: "False",
        publisher: "Example Checker",
        url: "https://example.org/check/1",
        publishedDate: "2026-10-30",
      },
    });
  });

  it.each([
    ["claimText", "missing-claim-text"],
    ["url", "missing-url"],
    ["publisher", "missing-publisher"],
  ] as const)("excludes a review with no %s under its own reason (%s)", (field, reason) => {
    const review: RawReview = { ...complete };
    delete review[field];
    expect(requireFields(review)).toEqual({ ok: false, reason });
  });

  it("treats empty and blank values as missing", () => {
    expect(requireFields({ ...complete, claimText: "" })).toEqual({ ok: false, reason: "missing-claim-text" });
    expect(requireFields({ ...complete, claimText: "   " })).toEqual({ ok: false, reason: "missing-claim-text" });
    expect(requireFields({ ...complete, url: "" })).toEqual({ ok: false, reason: "missing-url" });
  });

  it.each(["javascript:alert(1)", "data:text/html,x", "ftp://example.org/x", "/relative/path", "example.org/check", " https://example.org/x", "https://"])(
    "treats %j as a missing URL, because only absolute http(s) links are kept",
    (url) => {
      expect(requireFields({ ...complete, url })).toEqual({ ok: false, reason: "missing-url" });
    },
  );

  it("accepts http and https URLs", () => {
    expect(requireFields({ ...complete, url: "http://example.org/a?b=1#c" }).ok).toBe(true);
    expect(requireFields({ ...complete, url: "HTTPS://example.org/a" }).ok).toBe(true);
  });

  it("reports the first missing field when several are missing, in the order claim, URL, publisher", () => {
    expect(requireFields({})).toEqual({ ok: false, reason: "missing-claim-text" });
    expect(requireFields({ claimText: "A claim" })).toEqual({ ok: false, reason: "missing-url" });
    expect(requireFields({ claimText: "A claim", url: "https://example.org/x" })).toEqual({
      ok: false,
      reason: "missing-publisher",
    });
  });

  it("excludes a review with no rating text, because every stored record has one", () => {
    const review: RawReview = { ...complete };
    delete review.ratingText;
    expect(requireFields(review)).toEqual({ ok: false, reason: "missing-rating-text" });
  });

  it("does not look at the date: a missing date is the date rule's concern", () => {
    const review: RawReview = { ...complete };
    delete review.publishedDate;
    expect(requireFields(review)).toMatchObject({ ok: true });
  });
});

describe("publisher name is kept as provided", () => {
  it.each([
    "Fact Crescendo",
    "Fact Crescendo Sri Lanka",
    "FACTLY",
    "FACTLY ",
    "  Padded Name  ",
    "BR24 #Faktenfuchs",
    "فکت‌نامه",
  ])("stores %j unchanged", (publisher) => {
    const result = requireFields({ ...complete, publisher });
    expect(result).toMatchObject({ ok: true, value: { publisher } });
  });

  it("keeps name variants as separate values", () => {
    const a = requireFields({ ...complete, publisher: "Fact Crescendo" });
    const b = requireFields({ ...complete, publisher: "Fact Crescendo Sri Lanka" });
    expect(a.ok && b.ok && a.value.publisher !== b.value.publisher).toBe(true);
  });
});

describe("exclusion counts", () => {
  it("starts every reason at zero and counts each exclusion under its own reason", () => {
    const counts = createExclusionCounts();
    expect(Object.values(counts).every((n) => n === 0)).toBe(true);

    countExclusion(counts, "missing-claim-text");
    countExclusion(counts, "missing-claim-text");
    countExclusion(counts, "missing-url");

    expect(counts["missing-claim-text"]).toBe(2);
    expect(counts["missing-url"]).toBe(1);
    expect(counts["missing-publisher"]).toBe(0);
  });

  it("has a reason for every exclusion the specs name", () => {
    expect(Object.keys(createExclusionCounts()).sort()).toEqual(
      [
        "duplicate-url",
        "invalid-date",
        "future-date",
        "malformed",
        "missing-claim-text",
        "missing-publisher",
        "missing-rating-text",
        "missing-url",
        "non-english",
        "outside-window",
      ].sort(),
    );
  });
});
