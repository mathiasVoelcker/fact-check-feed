import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EmptyState, Feed } from "../app/feed/feed";
import { allowlist } from "../src/allowlist/allowlist";
import type { FeedCard } from "../src/feed/claims-query";

const root = fileURLToPath(new URL("..", import.meta.url));

const card = (id: number): FeedCard => ({
  id, url: `https://example.org/${id}`, claimText: `Claim ${id}`, ratingText: "False", ratingExplanation: null, originalUrl: null,
  originalVenue: null, originalAuthor: null, publisher: id % 2 ? "VERA Files" : "Factly", publishedOn: "2026-11-01", category: "false",
});

const attribution = allowlist.get("data-commons-claimreview")!.attributionText;

const render = (over: Partial<Parameters<typeof Feed>[0]> = {}) =>
  renderToStaticMarkup(
    createElement(Feed, {
      initial: { items: Array.from({ length: 50 }, (_, i) => card(i + 1)), nextCursor: "2026-11-01_1", total: 303 },
      choices: { publishers: ["Factly", "VERA Files"], categories: ["false", "true"] },
      attribution,
      ...over,
    }),
  );

describe("feed page", () => {
  it("shows the attribution text of the Data Commons allowlist entry", () => {
    expect(render()).toContain(attribution.replace(/&/g, "&amp;"));
  });

  it("shows how many claims match, not how many cards are rendered", () => {
    const markup = render();
    expect(markup.match(/<article/g)).toHaveLength(50);
    expect(markup).toContain("303");
  });

  it("offers a search box, a rating filter and a publisher filter built from the data, and no sort control", () => {
    const markup = render();
    expect(markup).toContain('type="search"');
    expect(markup).toContain("<option value=\"VERA Files\">");
    expect(markup).toContain("<option value=\"true\">");
    expect(markup.toLowerCase()).not.toMatch(/sort|newest first|most severe|order by/);
    expect(markup.match(/<select/g)).toHaveLength(2);
  });

  it("says there are no fact-checks yet for an empty database, with no cards", () => {
    const markup = render({ initial: { items: [], nextCursor: null, total: 0 }, choices: { publishers: [], categories: [] } });
    expect(markup).toContain("No fact-checks yet");
    expect(markup).not.toContain("<article");
  });

  it("says nothing matches and offers to clear the search and filters when a search finds nothing", () => {
    const markup = renderToStaticMarkup(createElement(EmptyState, { filtered: true, onClear: () => {} }));
    expect(markup).toContain("No fact-checks match");
    expect(markup).toContain("Clear the search and filters");
  });

  it("does not offer to clear anything when no filter is set", () => {
    const markup = renderToStaticMarkup(createElement(EmptyState, { filtered: false, onClear: () => {} }));
    expect(markup).not.toContain("Clear the search and filters");
  });

  it("shows a loading marker only while a next page exists", () => {
    expect(render()).toContain("Loading more");
    expect(render({ initial: { items: [card(1)], nextCursor: null, total: 1 } })).not.toContain("Loading more");
  });
});

/** Every source file of the feed: the app directory and the feed's own modules. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? sources(path) : /\.(ts|tsx)$/.test(name) ? [path] : [];
  });
}

describe("feed source rules", () => {
  const files = [...sources(join(root, "app")), ...sources(join(root, "src/feed"))];

  it("has found the feed's source files", () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it("requests nothing but its own claims route: no original-claim URL, no publisher site", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const call of text.matchAll(/\bfetch\s*\(([^)]*)\)?/g)) expect(call[1], `${file} calls fetch`).toContain("/api/claims");
      expect(text, `${file} requests a URL with XMLHttpRequest`).not.toContain("XMLHttpRequest");
    }
  });

  it("has no sort control or sort parameter in the feed sources", () => {
    for (const file of files) expect(readFileSync(file, "utf8"), file).not.toMatch(/sort=|"sort"|name="sort"|severity/i);
  });

  it("keeps the database connection out of every client component", () => {
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      if (text.trimStart().startsWith('"use client"')) expect(text, file).not.toMatch(/db\/client|DATABASE_URL|drizzle-orm|from "pg"/);
    }
  });
});
