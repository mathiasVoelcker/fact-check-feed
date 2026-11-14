import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const here = (relative: string) => fileURLToPath(new URL(relative, import.meta.url));
const E2E_DIR = here("../e2e/");

/** The scenario titles of the claim-feed spec. */
const scenarios = new Set(
  [...readFileSync(here("../openspec/specs/claim-feed/spec.md"), "utf8").matchAll(/^#### Scenario: (.+)$/gm)].map((m) => m[1]!.trim()),
);

/** Every `claim-feed :: <title>` in the e2e tests, given as the title of a `test(...)` call. */
export function e2eTitles(source: string): string[] {
  return [...source.matchAll(/\btest\(\s*(["'`])(.*?)\1/g)].map((m) => m[2]!);
}

describe("e2e test titles name real claim-feed scenarios", () => {
  it("reads titles the way the e2e files write them", () => {
    expect(e2eTitles(`test("claim-feed :: First page", async () => {}); test('x', () => {})`)).toEqual(["claim-feed :: First page", "x"]);
  });

  const files = existsSync(E2E_DIR) ? readdirSync(E2E_DIR).filter((f) => f.endsWith(".spec.ts")) : [];

  it.each(files)("%s: a title that starts with claim-feed :: names a scenario in the spec", (file) => {
    const named = e2eTitles(readFileSync(E2E_DIR + file, "utf8")).filter((t) => t.startsWith("claim-feed :: "));
    for (const title of named) expect(scenarios.has(title.slice("claim-feed :: ".length).trim()), title).toBe(true);
  });

  it("rejects a made-up scenario title", () => {
    expect(scenarios.has("Not a real scenario")).toBe(false);
    expect(scenarios.has("First page")).toBe(true);
  });
});
