import type { RatingCategory } from "../db/schema";

export type OriginLabel = { heading: string; line: string };

const FALSE_LABEL: OriginLabel = {
  heading: "The false claim, as it was posted",
  line: "This is the false claim itself, not a source.",
};

const MISLEADING_LABEL: OriginLabel = {
  heading: "The misleading claim, as it was posted",
  line: "This is the misleading claim itself, not a source.",
};

/** For every other category the claim is not known to be false, so the label must not say it is (design U3). */
const CHECKED_LABEL: OriginLabel = {
  heading: "The claim that was checked, as it was posted",
  line: "This is the claim that was checked, not a source. Read the rating and the fact-check to see how it held up.",
};

/**
 * The plain-words label for the block that shows where a claim appeared (E7 of store-claim-context, design U3).
 * The wording follows our rating category, not the publisher's free-text rating, which can be in any language.
 */
export function originLabel(category: RatingCategory): OriginLabel {
  if (category === "false") return FALSE_LABEL;
  if (category === "misleading") return MISLEADING_LABEL;
  return CHECKED_LABEL;
}
