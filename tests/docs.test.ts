import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { GEMINI_CLASSIFIER_VERSION, CLASSIFIER_MODEL } from "../src/classification/gemini";
import { MAX_RATING_LENGTH } from "../src/classification/service";
import { RATING_CATEGORIES } from "../src/db/schema";

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

describe("docs/ingestion.md", () => {
  const doc = read("../docs/ingestion.md");
  const scripts = (JSON.parse(read("../package.json")) as { scripts: Record<string, string> }).scripts;

  /** Every `npm run <script>` inside a fenced code block. */
  const documentedScripts = [...doc.matchAll(/```[a-z]*\n([\s\S]*?)```/g)]
    .flatMap((block) => [...block[1]!.matchAll(/npm run ([\w:-]+)/g)])
    .map((match) => match[1]!);

  it("documents how to run an ingestion", () => {
    expect(documentedScripts).toContain("ingest");
  });

  it("only documents npm scripts that exist", () => {
    for (const script of documentedScripts) expect(Object.keys(scripts), script).toContain(script);
  });

  it("names the settings a run needs", () => {
    expect(doc).toContain("DATABASE_URL");
    expect(doc).toContain("GEMINI_API_KEY");
    expect(doc).toContain("npm run db:migrate");
  });

  it("records the revisit trigger for the URL upsert key (D8)", () => {
    expect(doc).toMatch(/multi-claim/i);
    expect(doc).toContain("duplicate-url");
    expect(doc).toContain("(url, normalized claim text)");
  });

  it("records the revisit trigger for language detection (D9)", () => {
    expect(doc).toContain("tests/language.test.ts");
    expect(doc).toContain("tests/fixtures/language-labeled.json");
    expect(doc).toMatch(/franc-min/);
    expect(doc).toMatch(/tinyld/);
  });

  it("explains what a failed or repeated run does to the stored data", () => {
    expect(doc).toMatch(/safe to (re-?run|repeat)/i);
    expect(doc).toMatch(/unchanged|rolled back/i);
  });
});

describe("docs/rating-classification.md", () => {
  const doc = read("../docs/rating-classification.md");

  /** Category names in the first column of the "Categories" table. */
  const documentedCategories = (() => {
    const section = doc.split(/^## /m).find((part) => part.startsWith("Categories")) ?? "";
    return [...section.matchAll(/^\|\s*`([a-z]+)`\s*\|/gm)].map((match) => match[1]);
  })();

  it("documents exactly the categories the code and the spec define", () => {
    expect(documentedCategories.sort()).toEqual([...RATING_CATEGORIES].sort());
  });

  it("states which categories are negative", () => {
    expect(doc).toMatch(/negative[^\n]*`false`[^\n]*`misleading`/i);
  });

  it("explains that unclassifiable has no severity", () => {
    expect(doc).toMatch(/`unclassifiable`[^\n]*(no|null|without)[^\n]*severity|severity[^\n]*null[^\n]*`unclassifiable`/i);
  });

  it("names the model, the maximum text length and the classifier version in use", () => {
    expect(doc).toContain(CLASSIFIER_MODEL);
    expect(doc).toContain(String(MAX_RATING_LENGTH));
    expect(doc).toContain(GEMINI_CLASSIFIER_VERSION);
  });

  it("tells how to change the model or prompt and bump the version", () => {
    expect(doc).toContain("src/classification/gemini.ts");
    expect(doc).toContain("PROMPT_VERSION");
    expect(doc).toMatch(/classifier_version/);
  });
});
