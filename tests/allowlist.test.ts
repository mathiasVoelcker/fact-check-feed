import { describe, expect, it } from "vitest";
import { ALLOWLIST_ENTRIES, parseAllowlist } from "../src/allowlist/allowlist";

const validEntry = {
  sourceId: "example-feed",
  accessMethod: "bulk",
  license: "CC BY 4.0",
  attributionRequired: true,
  attributionText: "Data from Example.",
  url: "https://example.org/feed.json",
};

describe("allowlist loading", () => {
  it("accepts a complete entry with a valid access method", () => {
    const allowlist = parseAllowlist([validEntry]);
    expect(allowlist.get("example-feed")).toEqual(validEntry);
  });

  it.each(["API", "RSS", "bulk", "page"])("accepts the access method %s", (accessMethod) => {
    expect(() => parseAllowlist([{ ...validEntry, accessMethod }])).not.toThrow();
  });

  it.each(["license", "accessMethod", "attributionText", "url", "attributionRequired"])(
    "rejects an entry that lacks %s, naming the entry and the field",
    (field) => {
      const entry: Record<string, unknown> = { ...validEntry };
      delete entry[field];
      expect(() => parseAllowlist([entry])).toThrowError(
        new RegExp(`"example-feed".*"${field}"`),
      );
    },
  );

  it("rejects an unknown access method, naming the entry", () => {
    expect(() => parseAllowlist([{ ...validEntry, accessMethod: "scrape" }])).toThrowError(
      /"example-feed".*"accessMethod"/,
    );
  });

  it("rejects an entry without a source identifier", () => {
    const entry: Record<string, unknown> = { ...validEntry };
    delete entry.sourceId;
    expect(() => parseAllowlist([entry])).toThrowError(/entry 0.*"sourceId"/);
  });

  it("rejects two entries with the same source identifier", () => {
    expect(() => parseAllowlist([validEntry, validEntry])).toThrowError(/"example-feed".*duplicate/i);
  });
});

describe("initial allowlist content", () => {
  it("contains only the Data Commons ClaimReview feed", () => {
    const allowlist = parseAllowlist(ALLOWLIST_ENTRIES);
    expect([...allowlist.keys()]).toEqual(["data-commons-claimreview"]);
  });

  it("records it as a bulk download under CC BY 4.0 with attribution required", () => {
    const entry = parseAllowlist(ALLOWLIST_ENTRIES).get("data-commons-claimreview");
    expect(entry).toMatchObject({
      accessMethod: "bulk",
      license: "CC BY 4.0",
      attributionRequired: true,
      url: "https://storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json",
    });
    expect(entry?.attributionText).toContain("Data Commons");
    expect(entry?.attributionText).toContain("CC BY 4.0");
  });
});
