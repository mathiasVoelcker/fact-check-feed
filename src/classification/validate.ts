import { z } from "zod";
import { RATING_CATEGORIES } from "../db/schema";
import type { Classification } from "./types";

/**
 * The shape every classifier answer must have: a category from the fixed set, and a severity between 0 and 1
 * that is present for every category except unclassifiable, which has none.
 */
export const classificationSchema = z
  .object({
    category: z.enum(RATING_CATEGORIES),
    severity: z.number().min(0).max(1).nullable(),
  })
  .refine((value) => (value.category === "unclassifiable") === (value.severity === null), {
    message: "severity must be null exactly when the category is unclassifiable",
  });

/** Returns the answer if it is valid, otherwise null (the caller treats that as a failed classification). */
export function parseClassification(value: unknown): Classification | null {
  const result = classificationSchema.safeParse(value);
  return result.success ? result.data : null;
}
