import type { claims, RatingCategory } from "../src/db/schema";

export type SeedClaim = typeof claims.$inferInsert;

export const SEED_TOTAL = 120;
/** The search word that only a few seeded claims carry (design X4). */
export const RARE_WORD = "zebra";

const CATEGORIES: RatingCategory[] = ["false", "misleading", "mixed", "true", "unproven", "unclassifiable"];
const RATING_TEXT: Record<RatingCategory, string> = {
  false: "False",
  misleading: "Misleading",
  mixed: "Half true",
  true: "True",
  unproven: "Unproven",
  unclassifiable: "Needs context",
};
const SEVERITY: Record<RatingCategory, number | null> = { false: 1, misleading: 0.7, mixed: 0.45, true: 0.05, unproven: 0.25, unclassifiable: null };
const TOPICS = ["rivers", "comets", "tariffs", "vaccines", "elections"];
export const PUBLISHERS = ["Check Desk A", "Check Desk B", "Check Desk C", "Check Desk D", "Check Desk E"];

const LAST_DAY = Date.UTC(2026, 9, 30); // 2026-10-30

/**
 * 120 synthetic claims, newest first by index (two per day, so the id breaks ties). Nothing is copied from the live feed.
 * Every host is `.invalid`, which can never resolve, so a request to one fails loudly (design X4).
 * Origin: false, misleading and true claims in every other group of six; explanation: three claims in four.
 */
export function seedClaims(): SeedClaim[] {
  return Array.from({ length: SEED_TOTAL }, (_, i) => {
    const category = CATEGORIES[i % 6]!;
    const publisher = PUBLISHERS[i % PUBLISHERS.length]!;
    const hasOrigin = ["false", "misleading", "true"].includes(category) && Math.floor(i / 6) % 2 === 0;
    const rare = i % 20 === 7 ? ` ${RARE_WORD}` : "";
    return {
      url: `https://checks.invalid/claims/${i + 1}`,
      claimText: `Synthetic claim ${i + 1} about ${TOPICS[i % TOPICS.length]}${rare}`,
      ratingText: RATING_TEXT[category],
      ratingExplanation: i % 4 === 3 ? null : `Synthetic explanation for claim ${i + 1}.`,
      originalUrl: hasOrigin ? `https://posts.invalid/post/${i + 1}` : null,
      originalVenue: hasOrigin ? "In a synthetic post" : null,
      originalAuthor: hasOrigin ? `Synthetic Author ${i + 1}` : null,
      publisher,
      publishedOn: new Date(LAST_DAY - Math.floor(i / 2) * 86_400_000).toISOString().slice(0, 10),
      sourceId: "data-commons-claimreview",
      category,
      severity: SEVERITY[category],
    };
  });
}
