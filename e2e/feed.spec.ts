import { expect, test, type Page } from "@playwright/test";
import { PUBLISHERS, RARE_WORD, SEED_TOTAL, seedClaims, type SeedClaim } from "./seed";

// The seeded claims in the feed's order (review date, newest first; the id, which follows the seed index, breaks ties).
const ordered = seedClaims()
  .map((claim, index) => ({ ...claim, id: index + 1 }))
  .sort((a, b) => (a.publishedOn === b.publishedOn ? b.id - a.id : a.publishedOn < b.publishedOn ? 1 : -1));

type Query = { search?: string; category?: string; publisher?: string };

/** The claims the feed should list for a search and filters (the spec's search rules, restated for the test). */
function matching({ search = "", category, publisher }: Query) {
  const words = search.toLowerCase().split(/\s+/).filter(Boolean);
  return ordered.filter((c) => {
    const text = [c.claimText, c.ratingText, c.ratingExplanation, c.publisher, c.originalAuthor].join(" ").toLowerCase();
    return words.every((w) => text.includes(w)) && (!category || c.category === category) && (!publisher || c.publisher === publisher);
  });
}

const countText = (n: number) => `${n} fact-check${n === 1 ? "" : "s"} match`;
const cards = (page: Page) => page.locator("article");
const loadingMore = (page: Page) => page.getByText("Loading more…");
const claimTexts = (page: Page) => page.locator("article > p:first-of-type").allTextContents();
const withOrigin = (category: string): SeedClaim & { id: number } => ordered.find((c) => c.category === category && c.originalUrl)!;
const cardOf = (page: Page, claim: SeedClaim) => page.locator("article", { hasText: `${claim.claimText}` });

/** Scrolls the end of the list into view until the next page is shown. */
async function loadPage(page: Page, shown: number) {
  await loadingMore(page).scrollIntoViewIfNeeded();
  await expect(cards(page)).toHaveCount(shown);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/");
  await expect(page.getByText(countText(SEED_TOTAL))).toBeVisible();
});

test("claim-feed :: Newest first", async ({ page }) => {
  expect(await claimTexts(page)).toEqual(ordered.slice(0, 50).map((c) => c.claimText));
});

test("claim-feed :: First page", async ({ page }) => {
  await expect(cards(page)).toHaveCount(50);
});

test("claim-feed :: Count with more pages to load", async ({ page }) => {
  await expect(cards(page)).toHaveCount(50);
  await expect(page.getByText(`${SEED_TOTAL} fact-checks match`)).toBeVisible();
});

test("claim-feed :: Next page", async ({ page }) => {
  await loadPage(page, 100);
  expect((await claimTexts(page)).slice(50)).toEqual(ordered.slice(50, 100).map((c) => c.claimText));
});

test("claim-feed :: Last page", async ({ page }) => {
  await loadPage(page, 100);
  await loadPage(page, SEED_TOTAL);
  await expect(loadingMore(page)).toHaveCount(0);
  await page.waitForTimeout(500); // a stray request after the last page would add or fail something here
  await expect(cards(page)).toHaveCount(SEED_TOTAL);
});

test("claim-feed :: No duplicates or gaps", async ({ page }) => {
  await loadPage(page, 100);
  await loadPage(page, SEED_TOTAL);
  expect(await claimTexts(page)).toEqual(ordered.map((c) => c.claimText));
});

test("claim-feed :: Search words all must match", async ({ page }) => {
  await page.getByLabel("Search fact-checks").fill("tariffs");
  await expect(page.getByText(countText(matching({ search: "tariffs" }).length))).toBeVisible();
  await page.getByLabel("Search fact-checks").fill(`${RARE_WORD} tariffs`);
  const expected = matching({ search: `${RARE_WORD} tariffs` });
  await expect(page.getByText(countText(expected.length))).toBeVisible();
  expect(await claimTexts(page)).toEqual(expected.map((c) => c.claimText));
});

test("claim-feed :: Search ignores case", async ({ page }) => {
  await page.getByLabel("Search fact-checks").fill(RARE_WORD.toUpperCase());
  const expected = matching({ search: RARE_WORD });
  expect(expected.length).toBeGreaterThan(0);
  await expect(page.getByText(countText(expected.length))).toBeVisible();
  expect(await claimTexts(page)).toEqual(expected.map((c) => c.claimText));
});

test("claim-feed :: Rating and publisher filters combine", async ({ page }) => {
  const query = { search: "tariffs", category: "misleading", publisher: PUBLISHERS[2]! };
  await page.getByLabel("Search fact-checks").fill(query.search);
  await page.getByLabel("Filter by rating").selectOption(query.category);
  await page.getByLabel("Filter by publisher").selectOption(query.publisher);
  const expected = matching(query);
  await expect(page.getByText(countText(expected.length))).toBeVisible();
  expect(await claimTexts(page)).toEqual(expected.map((c) => c.claimText));
});

test("claim-feed :: Filter choices come from the data", async ({ page }) => {
  const options = (label: string) => page.getByLabel(label).locator("option").allTextContents();
  expect((await options("Filter by publisher")).slice(1).sort()).toEqual([...PUBLISHERS].sort());
  expect((await options("Filter by rating")).slice(1).sort()).toEqual([...new Set(ordered.map((c) => c.category))].sort());
});

test("claim-feed :: Count follows the filters", async ({ page }) => {
  await page.getByLabel("Filter by rating").selectOption("false");
  await expect(page.getByText(countText(matching({ category: "false" }).length))).toBeVisible();
});

test("claim-feed :: Filter restarts the list", async ({ page }) => {
  await loadPage(page, 100);
  await page.getByLabel("Filter by rating").selectOption("true");
  const expected = matching({ category: "true" });
  await expect(page.getByText(countText(expected.length))).toBeVisible();
  await expect(cards(page)).toHaveCount(Math.min(50, expected.length));
  expect(await claimTexts(page)).toEqual(expected.slice(0, 50).map((c) => c.claimText));
});

test("claim-feed :: No match", async ({ page }) => {
  await page.getByLabel("Search fact-checks").fill(`${RARE_WORD} rivers`);
  await expect(page.getByText("No fact-checks match.")).toBeVisible();
  await expect(cards(page)).toHaveCount(0);
  await page.getByRole("button", { name: "Clear the search and filters" }).click();
  await expect(page.getByText(countText(SEED_TOTAL))).toBeVisible();
  await expect(cards(page)).toHaveCount(50);
});

test("a failed page request shows a retry button that loads the page", async ({ page }) => {
  await page.route("**/api/claims*", (route) => route.abort());
  await loadingMore(page).scrollIntoViewIfNeeded();
  // Next has its own (empty) role=alert route announcer, so pick the one with our message.
  const alert = page.getByRole("alert").filter({ hasText: "Could not load more" });
  await expect(alert).toBeVisible();
  await expect(cards(page)).toHaveCount(50);
  await page.unroute("**/api/claims*");
  await alert.getByRole("button", { name: "Try again" }).click();
  await expect(cards(page)).toHaveCount(100);
  expect(await claimTexts(page)).toEqual(ordered.slice(0, 100).map((c) => c.claimText));
});

test("claim-feed :: Full card", async ({ page }) => {
  const claim = withOrigin("false");
  const card = cardOf(page, claim);
  await expect(card.locator("[data-badge=false]")).toHaveText("false");
  await expect(card).toContainText(`rated “${claim.ratingText}”`);
  await expect(card).toContainText(claim.ratingExplanation!);
  await expect(card).toContainText(`${claim.publisher} · ${claim.publishedOn}`);
  const link = card.locator("[data-link=fact-check]");
  await expect(link).toHaveAttribute("href", claim.url);
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer");
});

test("claim-feed :: Card without an explanation", async ({ page }) => {
  const claim = ordered.slice(0, 50).find((c) => !c.ratingExplanation && c.originalUrl)!;
  const card = cardOf(page, claim);
  await expect(card).not.toContainText("Why:");
  await expect(card.locator("[data-link=fact-check]")).toHaveText(`Read why at ${claim.publisher}`);
});

test("claim-feed :: Claim rated false", async ({ page }) => {
  const block = cardOf(page, withOrigin("false")).locator("[data-block=origin]");
  await expect(block).toContainText("The false claim, as it was posted");
  await expect(block).toContainText("This is the false claim itself, not a source.");
});

test("claim-feed :: Claim rated misleading", async ({ page }) => {
  const block = cardOf(page, withOrigin("misleading")).locator("[data-block=origin]");
  await expect(block).toContainText("The misleading claim, as it was posted");
  await expect(block).toContainText("This is the misleading claim itself, not a source.");
});

test("claim-feed :: Claim not rated false or misleading", async ({ page }) => {
  const block = cardOf(page, withOrigin("true")).locator("[data-block=origin]");
  await expect(block).toContainText("The claim that was checked, as it was posted");
  await expect(block).toContainText("not a source");
  await expect(block).not.toContainText(/false|misleading/i);
});

test("claim-feed :: Origin shown with the rating", async ({ page }) => {
  const claim = withOrigin("false");
  const card = cardOf(page, claim);
  await expect(card.locator("[data-block=origin]")).toBeVisible();
  await expect(card.locator("[data-badge=false]")).toBeVisible();
  await expect(card).toContainText(`rated “${claim.ratingText}”`);
});

test("claim-feed :: Card without origin", async ({ page }) => {
  const claim = ordered.slice(0, 50).find((c) => !c.originalUrl)!;
  await expect(cardOf(page, claim)).toBeVisible();
  await expect(cardOf(page, claim).locator("[data-block=origin]")).toHaveCount(0);
});

test("claim-feed :: Link attributes", async ({ page }) => {
  const claim = withOrigin("false");
  const link = cardOf(page, claim).locator("[data-link=original-claim]");
  await expect(link).toHaveAttribute("rel", "noopener noreferrer nofollow");
  await expect(link).toHaveAttribute("target", "_blank");
  await expect(link).toHaveText(`⚠ ${new URL(claim.originalUrl!).host} (not a source)`);
  await expect(link).not.toContainText(new URL(claim.originalUrl!).pathname);
});

test("claim-feed :: Not an ordinary link", async ({ page }) => {
  const card = cardOf(page, withOrigin("false"));
  const factCheck = card.locator("[data-link=fact-check]");
  const original = card.locator("[data-link=original-claim]");
  await expect(factCheck).not.toContainText("not a source");
  await expect(factCheck).toHaveAttribute("rel", "noopener noreferrer");
  await expect(original).toContainText("⚠");
  expect(await original.evaluate((el) => getComputedStyle(el).fontFamily)).not.toBe(await factCheck.evaluate((el) => getComputedStyle(el).fontFamily));
});

test("claim-feed :: Original URL is never requested", async ({ page }) => {
  const hosts = new Set<string>();
  page.on("request", (request) => hosts.add(new URL(request.url()).host));
  await page.goto("/");
  await loadPage(page, 100);
  await loadPage(page, SEED_TOTAL);
  await page.getByLabel("Filter by rating").selectOption("false");
  await expect(page.getByText(countText(matching({ category: "false" }).length))).toBeVisible();
  expect([...hosts]).toEqual(["127.0.0.1:3100"]);
});
