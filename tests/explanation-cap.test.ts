import { describe, expect, it } from "vitest";
import { MAX_EXPLANATION_LENGTH, capExplanation } from "../src/pipeline/explanation";

const hasLoneSurrogate = (text: string) => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/.test(text);

describe("capExplanation", () => {
  it("allows 1000 characters", () => {
    expect(MAX_EXPLANATION_LENGTH).toBe(1000);
  });

  it("leaves a text of 1000 characters or fewer exactly as written, whitespace included", () => {
    const exact = "a".repeat(1000);
    expect(capExplanation(exact)).toBe(exact);
    expect(capExplanation("  Short text.\n\nSecond line. ")).toBe("  Short text.\n\nSecond line. ");
  });

  it("cuts a longer text at a word boundary and ends it with an ellipsis, at most 1000 characters in total", () => {
    const original = "word ".repeat(300);
    const capped = capExplanation(original);

    expect(capped.length).toBeLessThanOrEqual(1000);
    expect(capped.endsWith("…")).toBe(true);
    const kept = capped.slice(0, -1);
    expect(original.startsWith(kept)).toBe(true);
    expect(kept).toBe(kept.trimEnd());
    expect(original.slice(kept.length)).toMatch(/^\s/);
  });

  it("does not cut inside a word when the cut falls mid-word", () => {
    const original = `${"alpha ".repeat(165)}${"b".repeat(40)} tail`;
    const capped = capExplanation(original);
    expect(capped.slice(0, -1)).toBe("alpha ".repeat(165).trimEnd());
  });

  it("cuts a single long word hard, still ending in the ellipsis within 1000 characters", () => {
    const capped = capExplanation("x".repeat(2000));
    expect(capped).toBe(`${"x".repeat(999)}…`);
  });

  it("never splits a surrogate pair", () => {
    const capped = capExplanation(`${"a".repeat(998)}😀${"b".repeat(50)}`);
    expect(hasLoneSurrogate(capped)).toBe(false);
    expect(capped.length).toBeLessThanOrEqual(1000);
    expect(capped.endsWith("…")).toBe(true);
  });
});
