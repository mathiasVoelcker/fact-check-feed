import { franc } from "franc-min";
import { detect } from "tinyld";

/** Share of a claim's letters that must be Latin before it can count as English (screens out mixed-script text). */
const MIN_LATIN_SHARE = 0.8;
/** franc-min's own default; shorter texts are left undetermined. */
const FRANC_MIN_LENGTH = 10;

const URL_PATTERN = /https?:\/\/\S+/g;

function latinShare(text: string): number {
  const letters = text.match(/\p{L}/gu);
  if (!letters) return 0;
  const latin = text.match(/\p{Script=Latin}/gu)?.length ?? 0;
  return latin / letters.length;
}

/**
 * Deterministic, offline English detection for a claim text (design D9).
 * A claim counts as English when it is mostly Latin script and either a trigram detector (franc-min) or a second
 * n-gram detector (tinyld) identifies it as English. The two cover each other's gaps on short claims and names.
 * Text the detectors cannot decide on is not English: a missed English claim is safer than a foreign one in an English feed.
 */
export function isEnglish(text: string): boolean {
  const cleaned = text.replace(URL_PATTERN, " ").trim();
  if (latinShare(cleaned) < MIN_LATIN_SHARE) return false;
  return franc(cleaned, { minLength: FRANC_MIN_LENGTH }) === "eng" || detect(cleaned) === "en";
}
