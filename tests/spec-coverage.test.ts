import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Every scenario in the three specs maps to the test(s) that cover it, as [test file, a fragment of the test title].
 * This test fails when a scenario has no entry here, when an entry names a scenario that no longer exists, or when
 * the named test has been renamed or removed. The tests themselves run with the rest of the suite.
 */
const COVERAGE: Record<string, [file: string, title: string][]> = {
  // source-allowlist
  "source-allowlist :: Complete entry is accepted": [["allowlist", "accepts a complete entry with a valid access method"]],
  "source-allowlist :: Entry with a missing field is rejected": [["allowlist", "rejects an entry that lacks"]],
  "source-allowlist :: Unknown access method is rejected": [["allowlist", "rejects an unknown access method, naming the entry"]],
  "source-allowlist :: Initial allowlist content": [["allowlist", "contains only the Data Commons ClaimReview feed"]],
  "source-allowlist :: Unlisted source is refused": [
    ["allowlist-guard", "refuses an unlisted source before any network request"],
    ["legal", "refuses an unlisted source before any request, even if its adapter could fetch"],
  ],
  "source-allowlist :: Listed source is fetched by its recorded method": [
    ["allowlist-guard", "fetches a listed source as a bulk download from the URL in its entry"],
  ],
  "source-allowlist :: Record carries its source": [["legal", "gives every stored record a source reference"]],
  "source-allowlist :: Attribution text is retrievable": [["legal", "lets a consumer look up the license and attribution text"]],

  // claim-ingestion
  "claim-ingestion :: Successful run": [["ingestion", "reports what it read, stored and excluded per reason"]],
  "claim-ingestion :: Download failure leaves data unchanged": [["ingestion", "changes nothing when the download fails"]],
  "claim-ingestion :: Honest identification": [
    ["data-commons-fetch", "identifies the application with a descriptive user-agent"],
    ["legal", "identifies itself in the request"],
  ],
  "claim-ingestion :: Only permitted fields are stored": [
    ["legal", "has exactly the permitted columns in the claims table"],
    ["legal", "stores no article text and no other feed field in any value"],
  ],
  "claim-ingestion :: Explanation is stored": [
    ["data-commons-adapter", "maps reviewRating.ratingExplanation, exactly as written"],
    ["rating-explanation", "stores the explanation of reviews that carry one, and nothing for the others"],
  ],
  "claim-ingestion :: Missing or blank explanation": [
    ["data-commons-adapter", "maps no explanation when it is missing, blank or not a string"],
    ["filter-entries", "keeps a review without an explanation and counts no exclusion for it"],
    ["rating-explanation", "does not count a review without an explanation as excluded"],
  ],
  "claim-ingestion :: Long explanation is cut": [
    ["explanation-cap", "cuts a longer text at a word boundary and ends it with an ellipsis, at most 1000 characters in total"],
    ["rating-explanation", "is stored cut to at most 1000 characters, ending in an ellipsis"],
  ],
  "claim-ingestion :: Explanation follows the feed on re-run": [
    ["rating-explanation", "replaces a stored explanation with the feed's on a re-run, and clears one the feed no longer has"],
  ],
  "claim-ingestion :: Removed explanation is cleared": [
    ["rating-explanation", "replaces a stored explanation with the feed's on a re-run, and clears one the feed no longer has"],
  ],
  "claim-ingestion :: Explanation never reaches the classifier": [
    ["rating-explanation", "gives the classifier rating texts only, never an explanation"],
  ],
  "claim-ingestion :: Publisher site is never contacted": [["legal", "requests nothing but the feed itself during a whole run"]],
  "claim-ingestion :: Name variants stay distinct": [
    ["filter-required-fields", "keeps name variants as separate values"],
    ["filter-entries", "keeps publisher names unchanged, including variants that differ by a suffix"],
  ],
  "claim-ingestion :: Missing claim text": [["filter-required-fields", "under its own reason"]],
  "claim-ingestion :: Missing URL": [["filter-required-fields", "under its own reason"]],
  "claim-ingestion :: Missing rating text": [["filter-required-fields", "excludes a review with no rating text"]],
  "claim-ingestion :: Missing date is excluded": [["filter-dates", "excludes a review with no published date"]],
  "claim-ingestion :: Unparseable date is excluded": [["filter-dates", "excludes the unparseable date"]],
  "claim-ingestion :: Future date is rejected": [["filter-dates", "rejects a date after the run date, under its own reason"]],
  "claim-ingestion :: Date of the run day is accepted": [["filter-dates", "accepts a date equal to the run day"]],
  "claim-ingestion :: Review inside the window": [["filter-dates", "is inside the window"]],
  "claim-ingestion :: Review outside the window": [["filter-dates", "is inside the window"]],
  "claim-ingestion :: Aged-out records are removed": [["ingestion", "removes stored records that have aged out, and keeps day 90"]],
  "claim-ingestion :: English claim is kept": [["language", "keeps at least 90% of the English claims"]],
  "claim-ingestion :: Non-English claim is excluded": [
    ["language", "excludes every %s claim"],
    ["language", "lets through at most 3% of the non-English claims"],
  ],
  "claim-ingestion :: Language of the rating text is irrelevant": [["filter-entries", "keeps English claims whatever language the rating text is in"]],
  "claim-ingestion :: Detection is repeatable": [
    ["language", "is repeatable: the same text gives the same answer every time"],
    ["language", "answers for every labeled claim without calling fetch"],
  ],
  "claim-ingestion :: New URL creates a record": [["ingestion", "creates a record for a URL that is not stored yet"]],
  "claim-ingestion :: Existing URL updates the record": [["ingestion", "updates a stored URL in place instead of adding a second record"]],
  "claim-ingestion :: Same URL twice in one run": [
    ["filter-entries", "stores one record per URL, and the last one in the run wins"],
    ["filter-entries", "counts every superseded review as a duplicate"],
  ],
  "claim-ingestion :: Re-running the same snapshot is idempotent": [["ingestion", "is idempotent: running the same snapshot again changes nothing"]],
  "claim-ingestion :: Failure during storage": [["ingestion", "rolls everything back when storing fails partway through"]],
  "claim-ingestion :: One malformed entry": [["filter-entries", "counts a malformed entry, skips it, and processes the rest"]],

  // rating-classification
  "rating-classification :: Clear false rating": [["gemini-classifier", "maps 'False' to the false category with the highest severity"]],
  "rating-classification :: Negative ratings outrank neutral ones": [["gemini-classifier", "ranks a negative rating above a neutral one"]],
  "rating-classification :: Unclassifiable rating": [["classification", "gives an unclassifiable rating no severity"]],
  "rating-classification :: False and misleading are negative": [["classification", "treats %s as negative"]],
  "rating-classification :: Other categories are not negative": [["classification", "does not treat %s as negative"]],
  "rating-classification :: Bilingual label": [["gemini-classifier", "maps a bilingual label to the same category as its English half"]],
  "rating-classification :: Verdict followed by explanation": [["gemini-classifier", "maps a verdict followed by an explanation to the verdict"]],
  "rating-classification :: Explanation without a verdict": [["gemini-classifier", "maps a sentence with no verdict to unclassifiable"]],
  "rating-classification :: Same text classified once": [["classification", "asks the classifier once per distinct text, however many records share it"]],
  "rating-classification :: Known text is not reclassified in a later run": [
    ["classification", "does not ask again in a later run for a text it has already classified"],
  ],
  "rating-classification :: Classifier unavailable": [["classification", "stores the record as unclassifiable, does not cache it, and reports the failure"]],
  "rating-classification :: Failed result is retried later": [["classification", "retries a failed text in the next run"]],
  "rating-classification :: Classifier input": [["classification", "sends the distinct rating texts and nothing else"]],
};

const CAPABILITIES = ["source-allowlist", "claim-ingestion", "rating-classification"];
const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));

/**
 * The scenarios of a capability: those in the main spec, plus those in the delta specs of changes that are still
 * in progress (they reach the main spec when the change is archived, and are then counted once).
 */
function specPaths(capability: string): string[] {
  const changesDir = here("../openspec/changes/");
  const deltas = readdirSync(changesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== "archive")
    .map((entry) => join(changesDir, entry.name, "specs", capability, "spec.md"))
    .filter(existsSync);
  const main = here(`../openspec/specs/${capability}/spec.md`);
  const found = [...(existsSync(main) ? [main] : []), ...deltas];
  if (found.length === 0) throw new Error(`No spec found for ${capability}`);
  return found;
}

const scenariosOf = (capability: string) => [
  ...new Set(
    specPaths(capability).flatMap((path) =>
      [...readFileSync(path, "utf8").matchAll(/^#### Scenario: (.+)$/gm)].map((match) => `${capability} :: ${match[1]!.trim()}`),
    ),
  ),
];

const specScenarios = CAPABILITIES.flatMap(scenariosOf);

describe("spec scenario coverage", () => {
  it("finds the scenarios of all three specs", () => {
    expect(specScenarios.length).toBe(53);
  });

  it("maps every scenario in the specs to at least one test", () => {
    const unmapped = specScenarios.filter((scenario) => !(COVERAGE[scenario]?.length));
    expect(unmapped, `scenarios with no test:\n${unmapped.join("\n")}`).toEqual([]);
  });

  it("has no mapping for a scenario that is not in the specs", () => {
    const known = new Set(specScenarios);
    const stale = Object.keys(COVERAGE).filter((scenario) => !known.has(scenario));
    expect(stale, `mappings for scenarios that no longer exist:\n${stale.join("\n")}`).toEqual([]);
  });

  it.each(Object.entries(COVERAGE))("%s names tests that exist", (_scenario, tests) => {
    for (const [file, title] of tests) {
      const path = here(`./${file}.test.ts`);
      expect(existsSync(path), `${file}.test.ts does not exist`).toBe(true);
      expect(readFileSync(path, "utf8"), `${file}.test.ts has no test titled like "${title}"`).toContain(title);
    }
  });
});
