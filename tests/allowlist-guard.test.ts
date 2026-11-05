import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { allowlist as defaultAllowlist } from "../src/allowlist/allowlist";
import { SourceNotAllowlistedError, fetchAllowlistedSource } from "../src/allowlist/guard";

const networkCall = vi.fn(() => {
  throw new Error("network access is not allowed in this test");
});

beforeEach(() => {
  networkCall.mockClear();
  vi.stubGlobal("fetch", networkCall);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("allowlist guard", () => {
  it("refuses an unlisted source before any network request", async () => {
    const bulk = vi.fn();
    await expect(fetchAllowlistedSource("not-a-listed-source", { bulk })).rejects.toThrowError(
      SourceNotAllowlistedError,
    );
    await expect(fetchAllowlistedSource("not-a-listed-source", { bulk })).rejects.toThrowError(
      /"not-a-listed-source".*not allowlisted/,
    );
    expect(bulk).not.toHaveBeenCalled();
    expect(networkCall).not.toHaveBeenCalled();
  });

  it("fetches a listed source as a bulk download from the URL in its entry", async () => {
    const entry = defaultAllowlist.get("data-commons-claimreview");
    const bulk = vi.fn(async () => "downloaded");
    const page = vi.fn();
    const api = vi.fn();
    const rss = vi.fn();

    const result = await fetchAllowlistedSource("data-commons-claimreview", { bulk, page, API: api, RSS: rss });

    expect(result).toBe("downloaded");
    expect(bulk).toHaveBeenCalledTimes(1);
    expect(bulk).toHaveBeenCalledWith(entry);
    expect(entry?.url).toBe("https://storage.googleapis.com/datacommons-feeds/claimreview/latest/data.json");
    expect(page).not.toHaveBeenCalled();
    expect(api).not.toHaveBeenCalled();
    expect(rss).not.toHaveBeenCalled();
    expect(networkCall).not.toHaveBeenCalled();
  });

  it("fails when no handler exists for the recorded access method", async () => {
    await expect(fetchAllowlistedSource("data-commons-claimreview", { page: vi.fn() })).rejects.toThrowError(
      /"data-commons-claimreview".*"bulk"/,
    );
    expect(networkCall).not.toHaveBeenCalled();
  });
});
