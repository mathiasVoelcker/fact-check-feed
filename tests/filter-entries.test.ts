import { describe, expect, it, vi } from "vitest";
import { type FilteredRecord, filterEntries } from "../src/pipeline/filter-entries";
import { EXCLUSION_REASONS } from "../src/pipeline/exclusions";
import { dataCommonsAdapter } from "../src/sources/data-commons/adapter";
import type { ParsedEntry, RawReview } from "../src/sources/types";
import { FIXTURE_PATH, FIXTURE_RUN_DATE } from "./support/fixture";

const RUN_DATE = "2026-11-02";
const alwaysEnglish = () => true;

const review = (overrides: Partial<RawReview> = {}): ParsedEntry => ({
  kind: "review",
  review: {
    claimText: "A claim",
    ratingText: "False",
    publisher: "Example Checker",
    publishedDate: "2026-10-30",
    url: "https://example.org/check/1",
    ...overrides,
  },
});

async function* stream(entries: ParsedEntry[]): AsyncGenerator<ParsedEntry> {
  yield* entries;
}

const run = (entries: ParsedEntry[], isEnglish = alwaysEnglish) =>
  filterEntries(stream(entries), { runDate: RUN_DATE, isEnglish });

describe("filterEntries: URL dedupe within a run", () => {
  it("stores one record per URL, and the last one in the run wins", async () => {
    const result = await run([
      review({ claimText: "First version", url: "https://example.org/same" }),
      review({ claimText: "Other article", url: "https://example.org/other" }),
      review({ claimText: "Last version", url: "https://example.org/same", ratingText: "Misleading" }),
    ]);

    expect(result.records).toHaveLength(2);
    const kept = result.records.find((r) => r.url === "https://example.org/same");
    expect(kept).toMatchObject({ claimText: "Last version", ratingText: "Misleading" });
  });

  it("counts every superseded review as a duplicate", async () => {
    const result = await run([
      review({ url: "https://example.org/same" }),
      review({ url: "https://example.org/same" }),
      review({ url: "https://example.org/same" }),
    ]);

    expect(result.records).toHaveLength(1);
    expect(result.counts["duplicate-url"]).toBe(2);
  });

  it("does not dedupe a review that another filter already excluded", async () => {
    const result = await run([
      review({ url: "https://example.org/same", publishedDate: "2026-11-03" }),
      review({ url: "https://example.org/same", claimText: "The valid one" }),
    ]);

    expect(result.records).toMatchObject([{ claimText: "The valid one" }]);
    expect(result.counts["future-date"]).toBe(1);
    expect(result.counts["duplicate-url"]).toBe(0);
  });
});

describe("filterEntries: malformed entries", () => {
  it("counts a malformed entry, skips it, and processes the rest", async () => {
    const result = await run([
      { kind: "malformed" },
      review({ url: "https://example.org/a" }),
      { kind: "malformed" },
      review({ url: "https://example.org/b" }),
    ]);

    expect(result.counts.malformed).toBe(2);
    expect(result.records.map((r) => r.url)).toEqual(["https://example.org/a", "https://example.org/b"]);
  });

  it("does not run any other filter on a malformed entry", async () => {
    const isEnglish = vi.fn(() => true);
    await run([{ kind: "malformed" }], isEnglish);
    expect(isEnglish).not.toHaveBeenCalled();
  });
});

describe("filterEntries: stage order and counts", () => {
  it("reports the first reason that excludes a review (required fields, then date, then window, then language)", async () => {
    const english = vi.fn((text: string) => text !== "Not English");
    const result = await filterEntries(
      stream([
        review({ claimText: "", publishedDate: "garbage" }),
        review({ url: "https://example.org/2", publishedDate: "garbage", claimText: "Not English" }),
        review({ url: "https://example.org/3", publishedDate: "2025-01-01", claimText: "Not English" }),
        review({ url: "https://example.org/4", claimText: "Not English" }),
      ]),
      { runDate: RUN_DATE, isEnglish: english },
    );

    expect(result.counts["missing-claim-text"]).toBe(1);
    expect(result.counts["invalid-date"]).toBe(1);
    expect(result.counts["outside-window"]).toBe(1);
    expect(result.counts["non-english"]).toBe(1);
    expect(result.records).toEqual([]);
  });

  it("only asks the language detector about reviews that passed every earlier filter, with the claim text", async () => {
    const english = vi.fn(() => true);
    await filterEntries(
      stream([review({ claimText: "Kept claim" }), review({ url: "https://example.org/2", publishedDate: "2024-01-01" })]),
      { runDate: RUN_DATE, isEnglish: english },
    );
    expect(english.mock.calls).toEqual([["Kept claim"]]);
  });

  it("returns the permitted fields of each kept review", async () => {
    const result = await run([review()]);
    expect(result.records).toEqual<FilteredRecord[]>([
      {
        url: "https://example.org/check/1",
        claimText: "A claim",
        ratingText: "False",
        publisher: "Example Checker",
        publishedOn: "2026-10-30",
      },
    ]);
  });

  it("counts everything it read, so read equals kept plus all exclusions", async () => {
    const result = await run([
      review(),
      review({ url: "https://example.org/2", claimText: "" }),
      { kind: "malformed" },
      review({ url: "https://example.org/1" }),
    ]);

    const excluded = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
    expect(result.read).toBe(4);
    expect(result.records.length + excluded).toBe(result.read);
  });
});

describe("filterEntries over the recorded fixture", () => {
  async function runFixture() {
    const entries = dataCommonsAdapter.parse(FIXTURE_PATH);
    return filterEntries(entries, { runDate: FIXTURE_RUN_DATE });
  }

  it("uses the fixture's reference run date", () => {
    expect(FIXTURE_RUN_DATE).toBe(RUN_DATE);
  });

  it("accounts for every entry: read equals kept plus the sum of all exclusions", async () => {
    const result = await runFixture();
    const excluded = Object.values(result.counts).reduce((sum, n) => sum + n, 0);
    expect(result.read).toBe(54);
    expect(result.records.length + excluded).toBe(result.read);
    expect(Object.keys(result.counts).sort()).toEqual([...EXCLUSION_REASONS].sort());
  });

  it("reports each exclusion reason the fixture was built to trigger", async () => {
    const { counts } = await runFixture();
    expect(counts.malformed).toBe(1);
    expect(counts["missing-claim-text"]).toBe(1);
    expect(counts["missing-url"]).toBe(1);
    expect(counts["missing-publisher"]).toBe(1);
    expect(counts["missing-rating-text"]).toBe(0);
    expect(counts["invalid-date"]).toBe(6);
    expect(counts["future-date"]).toBe(2);
    expect(counts["outside-window"]).toBe(4);
    // Two multi-claim articles share one URL each: Fact Crescendo (Buddha Sasana Minister) and Deutsche Welle.
    expect(counts["duplicate-url"]).toBe(2);
    expect(counts["non-english"]).toBeGreaterThanOrEqual(9);
    expect(counts["non-english"]).toBeLessThanOrEqual(14);
  });

  it("keeps one record for the shared URL, the last one in the feed", async () => {
    const { records } = await runFixture();
    const buddha = records.filter((r) => r.claimText.startsWith("The Buddha Sasana Minister"));
    expect(buddha).toHaveLength(1);
    expect(buddha[0]?.claimText).toContain("belittled");
  });

  it("keeps the window boundaries: day 89 and 90 in, day 91 out, and the run day in", async () => {
    const { records } = await runFixture();
    const dates = new Set(records.map((r) => r.publishedOn));
    expect(dates.has("2026-08-05")).toBe(true); // day 89
    expect(dates.has("2026-08-04")).toBe(true); // day 90
    expect(dates.has("2026-08-03")).toBe(false); // day 91
    expect(dates.has("2026-11-02")).toBe(true); // run day
  });

  it("keeps publisher names unchanged, including variants that differ by a suffix", async () => {
    const { records } = await runFixture();
    const publishers = new Set(records.map((r) => r.publisher));
    expect(publishers.has("Fact Crescendo")).toBe(true);
    expect(publishers.has("Fact Crescendo Sri Lanka")).toBe(true);
  });

  it("keeps English claims whatever language the rating text is in", async () => {
    const { records } = await runFixture();
    expect(records.some((r) => r.ratingText === "பொய் / False")).toBe(true);
    expect(records.some((r) => r.ratingText === "අසත්‍යයි / False")).toBe(true);
  });

  it("stores only English claims", async () => {
    const { records } = await runFixture();
    expect(records.every((r) => /^[\x20-\x7E‘-”–—… ]+$/.test(r.claimText))).toBe(true);
  });
});

describe("filterEntries: rating explanation", () => {
  it("carries the explanation onto the kept record", async () => {
    const result = await run([review({ ratingExplanation: "Global indices show otherwise." })]);
    expect(result.records).toMatchObject([{ ratingExplanation: "Global indices show otherwise." }]);
  });

  it("caps a long explanation", async () => {
    const result = await run([review({ ratingExplanation: "word ".repeat(400) })]);
    const stored = result.records[0]?.ratingExplanation ?? "";
    expect(stored.length).toBeLessThanOrEqual(1000);
    expect(stored.endsWith("…")).toBe(true);
  });

  it("keeps a review without an explanation and counts no exclusion for it", async () => {
    const result = await run([review(), review({ url: "https://example.org/check/2", ratingExplanation: "Because." })]);
    expect(result.records).toHaveLength(2);
    expect(result.records.find((r) => r.url === "https://example.org/check/1")?.ratingExplanation).toBeUndefined();
    expect(result.read).toBe(2);
    expect(Object.values(result.counts).reduce((sum, n) => sum + n, 0)).toBe(0);
  });

  it("lets the last review for a URL win, including when it has no explanation", async () => {
    const url = "https://example.org/same";
    const result = await run([review({ url, ratingExplanation: "Older explanation." }), review({ url })]);
    expect(result.records).toHaveLength(1);
    expect(result.records[0]?.ratingExplanation).toBeUndefined();
  });
});
