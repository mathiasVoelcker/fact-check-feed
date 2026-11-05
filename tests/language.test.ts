import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isEnglish } from "../src/pipeline/language";

type Labeled = { text: string; english: boolean; language: string };

const labeled = JSON.parse(
  readFileSync(fileURLToPath(new URL("./fixtures/language-labeled.json", import.meta.url)), "utf8"),
) as Labeled[];

const englishOnly = labeled.filter((row) => row.english);
const foreign = labeled.filter((row) => !row.english);
const ofKind = (prefix: string) => labeled.filter((row) => row.language.startsWith(prefix));

/** Fraction of `rows` for which the detector answers `expected`. */
const rate = (rows: Labeled[], expected: boolean) =>
  rows.filter((row) => isEnglish(row.text) === expected).length / rows.length;

const wrong = (rows: Labeled[], expected: boolean) =>
  rows.filter((row) => isEnglish(row.text) !== expected).map((row) => `${row.language}: ${row.text.slice(0, 70)}`);

describe("labeled language fixture", () => {
  it("covers the languages and lengths the English filter has to handle", () => {
    expect(labeled.length).toBeGreaterThanOrEqual(150);
    for (const language of ["persian-or-arabic", "sinhala", "tamil", "english-short", "english-medium", "english-long"]) {
      expect(ofKind(language).length, language).toBeGreaterThanOrEqual(8);
    }
    expect(englishOnly.every((row) => row.language.startsWith("english"))).toBe(true);
  });
});

describe("English detection accuracy", () => {
  it("keeps at least 90% of the English claims", () => {
    expect(rate(englishOnly, true), `wrongly dropped:\n${wrong(englishOnly, true).join("\n")}`).toBeGreaterThanOrEqual(0.9);
  });

  it("keeps at least 95% of the long and medium English claims", () => {
    const longer = [...ofKind("english-medium"), ...ofKind("english-long")];
    expect(rate(longer, true), `wrongly dropped:\n${wrong(longer, true).join("\n")}`).toBeGreaterThanOrEqual(0.95);
  });

  it("keeps at least 75% of the short English claims, the known weak spot", () => {
    const short = ofKind("english-short");
    expect(rate(short, true), `wrongly dropped:\n${wrong(short, true).join("\n")}`).toBeGreaterThanOrEqual(0.75);
  });

  it("lets through at most 3% of the non-English claims", () => {
    expect(rate(foreign, true), `wrongly kept:\n${wrong(foreign, false).join("\n")}`).toBeLessThanOrEqual(0.03);
  });

  it.each([
    ["Persian or Arabic", "persian-or-arabic"],
    ["Sinhala", "sinhala"],
    ["Tamil", "tamil"],
    ["Telugu", "telugu"],
    ["Devanagari", "devanagari"],
    ["Bengali", "bengali"],
    ["Cyrillic", "cyrillic"],
  ])("excludes every %s claim", (_name, language) => {
    const rows = ofKind(language);
    expect(rows.length).toBeGreaterThan(0);
    expect(wrong(rows, false)).toEqual([]);
  });

  it.each([
    ["Spanish", "spanish"],
    ["German", "german"],
    ["French", "french"],
  ])("excludes at least 80%% of the %s claims", (_name, language) => {
    expect(rate(ofKind(language), false)).toBeGreaterThanOrEqual(0.8);
  });
});

describe("English detection behavior", () => {
  it.each(["", "   ", "123 456", "???", "https://example.org/check/1"])("does not keep %j, which has no language to detect", (text) => {
    expect(isEnglish(text)).toBe(false);
  });

  it("does not keep a claim that is mostly another script with an English phrase in it", () => {
    // A real Sinhala claim that mentions "Pink Panther"; tinyld alone calls it English.
    expect(isEnglish("ප්‍රංශ විරෝධතාවලදී Pink Panther ඇඳුමින් සැරසුණු විරෝධතාකරුවෙකු පොලිසිය අත්අඩංගුවට ගත් බව.")).toBe(false);
  });

  it("is repeatable: the same text gives the same answer every time", () => {
    const sample = labeled.map((row) => row.text);
    const first = sample.map(isEnglish);
    for (let run = 0; run < 3; run++) expect(sample.map(isEnglish)).toEqual(first);
  });

  it("does not depend on surrounding whitespace", () => {
    const text = englishOnly[0]!.text;
    expect(isEnglish(`  ${text}\n`)).toBe(isEnglish(text));
  });
});

describe("English detection makes no network request", () => {
  const networkCall = vi.fn(() => {
    throw new Error("network access is not allowed in this test");
  });

  beforeEach(() => {
    networkCall.mockClear();
    vi.stubGlobal("fetch", networkCall);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers for every labeled claim without calling fetch", () => {
    for (const row of labeled) isEnglish(row.text);
    expect(networkCall).not.toHaveBeenCalled();
  });
});
