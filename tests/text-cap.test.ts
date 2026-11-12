import { describe, expect, it } from "vitest";
import { MAX_EXPLANATION_LENGTH, MAX_ORIGIN_LABEL_LENGTH, capText } from "../src/pipeline/cap";

const hasLoneSurrogate = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe("the caps", () => {
  it("allows 1000 characters for an explanation and 200 for a venue or author name", () => {
    expect(MAX_EXPLANATION_LENGTH).toBe(1000);
    expect(MAX_ORIGIN_LABEL_LENGTH).toBe(200);
  });
});

describe.each([MAX_EXPLANATION_LENGTH, MAX_ORIGIN_LABEL_LENGTH])("capText with a limit of %i", (limit) => {
  it("leaves a text of the limit or fewer characters exactly as written, whitespace included", () => {
    const exact = "a".repeat(limit);
    expect(capText(exact, limit)).toBe(exact);
    expect(capText("  Short text.\n\nSecond line. ", limit)).toBe("  Short text.\n\nSecond line. ");
  });

  it("cuts a longer text at a word boundary and ends it with an ellipsis, at most the limit in total", () => {
    const original = "word ".repeat(limit);
    const capped = capText(original, limit);

    expect(capped.length).toBeLessThanOrEqual(limit);
    expect(capped.endsWith("…")).toBe(true);
    const kept = capped.slice(0, -1);
    expect(original.startsWith(kept)).toBe(true);
    expect(kept).toBe(kept.trimEnd());
    expect(original.slice(kept.length)).toMatch(/^\s/);
  });

  it("does not cut inside a word when the cut falls mid-word", () => {
    const words = "alpha ".repeat(Math.floor(limit / 6) - 1);
    const original = `${words}${"b".repeat(40)} tail`;
    expect(capText(original, limit).slice(0, -1)).toBe(words.trimEnd());
  });

  it("cuts a single long word hard, still ending in the ellipsis within the limit", () => {
    expect(capText("x".repeat(limit * 2), limit)).toBe(`${"x".repeat(limit - 1)}…`);
  });

  it("never splits a surrogate pair", () => {
    const capped = capText(`${"a".repeat(limit - 2)}😀${"b".repeat(50)}`, limit);
    expect(hasLoneSurrogate(capped)).toBe(false);
    expect(capped.length).toBeLessThanOrEqual(limit);
    expect(capped.endsWith("…")).toBe(true);
  });
});
