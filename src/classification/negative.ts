import type { RatingCategory } from "../db/schema";

const NEGATIVE_CATEGORIES: readonly RatingCategory[] = ["false", "misleading"];

/** "Negative" is derived from the category, not stored, so there is a single source of truth (design D5). */
export function isNegative(category: RatingCategory): boolean {
  return NEGATIVE_CATEGORIES.includes(category);
}
