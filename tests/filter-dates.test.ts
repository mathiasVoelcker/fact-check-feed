import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { checkDate, WINDOW_DAYS } from "../src/pipeline/filters";
import { dataCommonsAdapter } from "../src/sources/data-commons/adapter";

const RUN_DATE = "2026-11-02";

/** The date `days` before the run date (negative for after), as YYYY-MM-DD. */
function daysBefore(days: number, runDate = RUN_DATE): string {
  const date = new Date(Date.parse(runDate) - days * 24 * 60 * 60 * 1000);
  return date.toISOString().slice(0, 10);
}

describe("review date validity", () => {
  it("excludes a review with no published date", () => {
    expect(checkDate(undefined, RUN_DATE)).toEqual({ ok: false, reason: "invalid-date" });
  });

  it.each(["", "   ", "yesterday", "30/10/2026", "2026-10", "2026", "20204-08-02", "2-12-30", "710-01-01", "2026-10-30abc"])(
    "excludes the unparseable date %j",
    (value) => {
      expect(checkDate(value, RUN_DATE)).toEqual({ ok: false, reason: "invalid-date" });
    },
  );

  it.each(["2026-02-30", "2026-13-01", "2026-00-10", "2026-04-31", "2025-02-29", "2026-10-00", "2026-10-32"])(
    "excludes the impossible calendar date %s",
    (value) => {
      expect(checkDate(value, RUN_DATE)).toEqual({ ok: false, reason: "invalid-date" });
    },
  );

  it("accepts a real leap day", () => {
    expect(checkDate("2024-02-29", "2024-03-10")).toEqual({ ok: true, value: { publishedOn: "2024-02-29" } });
  });

  it.each(["2026-10-30T14:22:05+00:00", "2026-10-30T14:22:05Z", "2026-10-30 14:22:05", "2026-10-30T00:00:00"])(
    "reads the leading date of %s",
    (value) => {
      expect(checkDate(value, RUN_DATE)).toEqual({ ok: true, value: { publishedOn: "2026-10-30" } });
    },
  );
});

describe("future dates", () => {
  it("rejects a date after the run date, under its own reason", () => {
    expect(checkDate("2026-11-03", RUN_DATE)).toEqual({ ok: false, reason: "future-date" });
    expect(checkDate("2923-01-02", RUN_DATE)).toEqual({ ok: false, reason: "future-date" });
  });

  it("accepts a date equal to the run day", () => {
    expect(checkDate(RUN_DATE, RUN_DATE)).toEqual({ ok: true, value: { publishedOn: RUN_DATE } });
  });

  it("treats a time later on the run day as the run day, not the future", () => {
    expect(checkDate("2026-11-02T23:59:59+00:00", RUN_DATE)).toMatchObject({ ok: true });
  });
});

describe("rolling 90-day window", () => {
  it("is 90 days", () => {
    expect(WINDOW_DAYS).toBe(90);
  });

  it.each([
    [0, true],
    [1, true],
    [89, true],
    [90, true],
    [91, false],
    [92, false],
    [365, false],
  ])("a review published %i days before the run date is inside the window: %s", (days, inside) => {
    const result = checkDate(daysBefore(days), RUN_DATE);
    expect(result).toEqual(inside ? { ok: true, value: { publishedOn: daysBefore(days) } } : { ok: false, reason: "outside-window" });
  });

  it("works across month and year boundaries", () => {
    // 2025-10-03 is exactly 90 days before 2026-01-01.
    expect(checkDate("2025-10-04", "2026-01-01")).toEqual({ ok: true, value: { publishedOn: "2025-10-04" } });
    expect(checkDate("2025-10-03", "2026-01-01")).toEqual({ ok: true, value: { publishedOn: "2025-10-03" } });
    expect(checkDate("2025-10-02", "2026-01-01")).toEqual({ ok: false, reason: "outside-window" });
  });

  it("checks the date before the window, so a future date is never 'outside the window'", () => {
    expect(checkDate("2026-11-03", RUN_DATE)).toEqual({ ok: false, reason: "future-date" });
  });
});

describe("no fallback to another date", () => {
  let workDir: string;

  beforeAll(async () => {
    workDir = await mkdtemp(join(tmpdir(), "date-test-"));
  });

  afterAll(async () => {
    await rm(workDir, { recursive: true, force: true });
  });

  it("does not use the feed element's dateCreated when the review has no published date", async () => {
    const path = join(workDir, "feed.json");
    await writeFile(
      path,
      JSON.stringify({
        dataFeedElement: [
          {
            "@type": "DataFeedItem",
            dateCreated: "2026-11-01T10:00:00+00:00",
            item: [
              { claimReviewed: "A claim", url: "https://example.org/a", dateModified: "2026-11-01", dateCreated: "2026-11-01" },
            ],
          },
        ],
      }),
    );

    const entries = [];
    for await (const entry of dataCommonsAdapter.parse(path)) entries.push(entry);
    const review = entries[0]?.kind === "review" ? entries[0].review : undefined;

    expect(review?.publishedDate).toBeUndefined();
    expect(checkDate(review?.publishedDate, RUN_DATE)).toEqual({ ok: false, reason: "invalid-date" });
  });
});
