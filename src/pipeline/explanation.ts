/** The most characters of a publisher's rating explanation that is stored (design E1). */
export const MAX_EXPLANATION_LENGTH = 1000;

const ELLIPSIS = "…";

/**
 * A text within the cap is returned exactly as written. A longer one is cut at a word boundary and ends with an
 * ellipsis, so the result never exceeds the cap; a single word longer than the cap is cut hard.
 */
export function capExplanation(text: string): string {
  if (text.length <= MAX_EXPLANATION_LENGTH) return text;

  let kept = text.slice(0, MAX_EXPLANATION_LENGTH - ELLIPSIS.length);
  // Cutting mid-word: fall back to the last whitespace. If the next character is whitespace the cut is already clean.
  if (!/\s/.test(text.charAt(kept.length))) {
    const lastWord = /\s\S*$/.exec(kept);
    if (lastWord && lastWord.index > 0) kept = kept.slice(0, lastWord.index);
  }
  kept = kept.trimEnd();
  // Never leave half of a surrogate pair.
  if (/[\uD800-\uDBFF]$/.test(kept)) kept = kept.slice(0, -1);
  return kept + ELLIPSIS;
}
