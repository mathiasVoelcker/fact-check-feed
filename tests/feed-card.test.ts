import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ClaimCard } from "../app/feed/claim-card";
import { RATING_CATEGORIES } from "../src/db/schema";
import type { FeedCard } from "../src/feed/claims-query";
import { originLabel } from "../src/feed/origin-label";

const claim = (over: Partial<FeedCard> = {}): FeedCard => ({
  id: 1,
  url: "https://publisher.example/fact-check/1",
  claimText: "Witnesses want to return to the Philippines.",
  ratingText: "Pants on Fire",
  ratingExplanation: "No statement confirms this.",
  originalUrl: "https://www.facebook.com/share/p/abc123/?utm=tracking",
  originalVenue: "In a Facebook post",
  originalAuthor: "Facebook page Naknak Vlog",
  publisher: "VERA Files",
  publishedOn: "2026-11-10",
  category: "false",
  ...over,
});

const html = (c: FeedCard) => renderToStaticMarkup(createElement(ClaimCard, { claim: c }));

/** The attributes of the first <a> that has the given data-link marker. */
function link(markup: string, kind: "fact-check" | "original-claim") {
  const match = new RegExp(`<a [^>]*data-link="${kind}"[^>]*>([\\s\\S]*?)</a>`).exec(markup);
  if (!match) return null;
  const tag = match[0].slice(0, match[0].indexOf(">") + 1);
  const attr = (name: string) => new RegExp(`${name}="([^"]*)"`).exec(tag)?.[1];
  return { text: match[1]!.replace(/<[^>]+>/g, ""), href: attr("href"), rel: attr("rel"), target: attr("target") };
}

describe("claim card: content", () => {
  it("shows the badge, rating text, claim, explanation, publisher, date and fact-check link of a full card", () => {
    const markup = html(claim());
    expect(markup).toContain("false");
    expect(markup).toContain("Pants on Fire");
    expect(markup).toContain("Witnesses want to return to the Philippines.");
    expect(markup).toContain("No statement confirms this.");
    expect(markup).toContain("VERA Files");
    expect(markup).toContain("2026-11-10");
    expect(link(markup, "fact-check")?.href).toBe("https://publisher.example/fact-check/1");
  });

  it("has no explanation block when the claim has no explanation, and the link says where to read the reasoning", () => {
    const markup = html(claim({ ratingExplanation: null }));
    expect(markup).not.toContain("Why:");
    expect(link(markup, "fact-check")?.text).toBe("Read why at VERA Files");
  });

  it("calls the link 'Read the full fact-check' when the card shows the explanation", () => {
    expect(link(html(claim()), "fact-check")?.text).toBe("Read the full fact-check");
  });

  it("opens the fact-check link in a new tab with rel noopener noreferrer", () => {
    const l = link(html(claim()), "fact-check");
    expect(l?.target).toBe("_blank");
    expect(l?.rel).toBe("noopener noreferrer");
  });

  it("escapes claim text instead of rendering it as markup", () => {
    const markup = html(claim({ claimText: "<script>alert(1)</script>" }));
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("&lt;script&gt;");
  });

  it("does not show the original author, venue or link on a card without an origin block", () => {
    const markup = html(claim({ originalUrl: null, originalVenue: null, originalAuthor: null }));
    expect(markup).not.toContain('data-block="origin"');
    expect(link(markup, "original-claim")).toBeNull();
  });
});

describe("claim card: origin of the claim (E7)", () => {
  it("says the claim is false when the category is false", () => {
    const markup = html(claim({ category: "false" }));
    expect(markup).toContain("The false claim, as it was posted");
    expect(markup).toContain("This is the false claim itself, not a source.");
  });

  it("says the claim is misleading when the category is misleading", () => {
    const markup = html(claim({ category: "misleading" }));
    expect(markup).toContain("The misleading claim, as it was posted");
    expect(markup).toContain("This is the misleading claim itself, not a source.");
  });

  it.each(["true", "mixed", "unproven", "unclassifiable"] as const)("calls a claim rated %s the claim that was checked, never false or misleading", (category) => {
    const block = /<div[^>]*data-block="origin"[^>]*>[\s\S]*?<\/div>/.exec(html(claim({ category })))![0];
    expect(block).toContain("The claim that was checked, as it was posted");
    expect(block).toContain("not a source");
    expect(block.toLowerCase()).not.toMatch(/false|misleading/);
  });

  it("gives every rating category a label that says it is not a source", () => {
    for (const category of RATING_CATEGORIES) expect(originLabel(category).line).toContain("not a source");
  });

  it("shows the origin block together with the rating badge and rating text", () => {
    const markup = html(claim({ category: "mixed", ratingText: "Half True" }));
    expect(markup).toContain('data-block="origin"');
    expect(markup).toContain("Half True");
    expect(markup).toContain('data-badge="mixed"');
  });

  it("shows the author and the venue as given", () => {
    const markup = html(claim());
    expect(markup).toContain("Facebook page Naknak Vlog");
    expect(markup).toContain("In a Facebook post");
  });

  it("shows the origin block when only an author is known, with no link", () => {
    const markup = html(claim({ originalUrl: null, originalVenue: null }));
    expect(markup).toContain('data-block="origin"');
    expect(markup).toContain("Facebook page Naknak Vlog");
    expect(link(markup, "original-claim")).toBeNull();
  });
});

describe("claim card: link to the original claim", () => {
  it("opens in a new tab with rel noopener noreferrer nofollow", () => {
    const l = link(html(claim()), "original-claim");
    expect(l?.target).toBe("_blank");
    expect(l?.rel).toBe("noopener noreferrer nofollow");
  });

  it("shows the host with a warning marker, not the full URL", () => {
    const l = link(html(claim()), "original-claim");
    expect(l?.text).toContain("⚠");
    expect(l?.text).toContain("www.facebook.com");
    expect(l?.text).not.toContain("utm=tracking");
    expect(l?.text).not.toContain("https://");
  });

  it("is marked differently from the fact-check link, which alone invites reading more", () => {
    const markup = html(claim());
    const original = link(markup, "original-claim")!;
    const factCheck = link(markup, "fact-check")!;
    expect(original.text).toContain("not a source");
    expect(factCheck.text).not.toContain("⚠");
    expect(factCheck.text).toMatch(/Read /);
    expect(original.text).not.toMatch(/read|more|source:/i);
  });

  it.each(["javascript:alert(1)", "/relative/path", "ftp://host.example/x", "not a url", "data:text/html,hi"])("does not link %s", (originalUrl) => {
    const markup = html(claim({ originalUrl }));
    expect(link(markup, "original-claim")).toBeNull();
    expect(markup).not.toContain(originalUrl.replace(/&/g, "&amp;"));
  });

  it("links an http URL as well as an https URL", () => {
    expect(link(html(claim({ originalUrl: "http://old.example/p" })), "original-claim")?.href).toBe("http://old.example/p");
  });
});
