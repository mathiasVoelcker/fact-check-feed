import { z } from "zod";

export const ACCESS_METHODS = ["API", "RSS", "bulk", "page"] as const;

const allowlistEntrySchema = z.object({
  sourceId: z.string().min(1),
  accessMethod: z.enum(ACCESS_METHODS),
  license: z.string().min(1),
  attributionRequired: z.boolean(),
  attributionText: z.string().min(1),
  url: z.url(),
});

export type AccessMethod = (typeof ACCESS_METHODS)[number];
export type AllowlistEntry = z.infer<typeof allowlistEntrySchema>;
export type Allowlist = ReadonlyMap<string, AllowlistEntry>;

/** Every source the system may read. Changing this list is a reviewed code change. */
export const ALLOWLIST_ENTRIES: readonly unknown[] = [
  {
    sourceId: "data-commons-claimreview",
    accessMethod: "bulk",
    license: "CC BY 4.0",
    attributionRequired: true,
    attributionText:
      "Fact-check data from Google Data Commons (datacommons.org/factcheck), licensed CC BY 4.0. Each item links to the original fact-check by its publisher.",
    url: "https://storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json",
  },
];

function describeEntry(raw: unknown, index: number): string {
  const sourceId =
    typeof raw === "object" && raw !== null && "sourceId" in raw ? (raw as { sourceId: unknown }).sourceId : undefined;
  return typeof sourceId === "string" && sourceId !== "" ? `"${sourceId}"` : `entry ${index}`;
}

/** Validates raw allowlist entries; the error names the offending entry and field. */
export function parseAllowlist(rawEntries: readonly unknown[]): Allowlist {
  const allowlist = new Map<string, AllowlistEntry>();
  rawEntries.forEach((raw, index) => {
    const result = allowlistEntrySchema.safeParse(raw);
    if (!result.success) {
      const fields = [...new Set(result.error.issues.map((issue) => `"${String(issue.path[0] ?? "(entry)")}"`))];
      throw new Error(`Invalid allowlist ${describeEntry(raw, index)}: missing or invalid field ${fields.join(", ")}`);
    }
    if (allowlist.has(result.data.sourceId)) {
      throw new Error(`Invalid allowlist entry "${result.data.sourceId}": duplicate source identifier`);
    }
    allowlist.set(result.data.sourceId, result.data);
  });
  return allowlist;
}

export const allowlist: Allowlist = parseAllowlist(ALLOWLIST_ENTRIES);
