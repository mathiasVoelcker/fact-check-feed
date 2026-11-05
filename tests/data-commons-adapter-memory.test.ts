import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import v8 from "node:v8";
import vm from "node:vm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { dataCommonsAdapter } from "../src/sources/data-commons/adapter";

const REVIEW_COUNT = 220_000;
const MB = 1024 * 1024;
const SAMPLE_EVERY = 20_000;

// Lets the test collect garbage on demand, so it measures memory that is still retained, not garbage waiting for a sweep.
v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc") as () => void;

const retainedHeap = () => {
  collectGarbage();
  return process.memoryUsage().heapUsed;
};

let workDir: string;
let largeFile: string;

/** Writes a feed of `count` reviews without ever holding it in memory. */
async function generateFeed(path: string, count: number): Promise<void> {
  const out = createWriteStream(path);
  const write = async (chunk: string) => {
    if (!out.write(chunk)) await once(out, "drain");
  };
  await write('{"@type":"DataFeed","dataFeedElement":[');
  for (let i = 0; i < count; i++) {
    const review = {
      "@type": "ClaimReview",
      author: { "@type": "Organization", name: `Publisher ${i % 50}`, url: "https://example.org/" },
      claimReviewed: `Claim number ${i} that is long enough to look like a real claim made on social media`,
      datePublished: "2026-10-30",
      itemReviewed: { "@type": "Claim", author: { "@type": "Person", name: "Somebody" } },
      reviewRating: { "@type": "Rating", alternateName: i % 3 === 0 ? "False" : "Misleading" },
      sdPublisher: { "@type": "Organization", name: "Google Fact Check Tools" },
      url: `https://example.org/fact-checks/${i}`,
    };
    await write(`${i === 0 ? "" : ","}{"@type":"DataFeedItem","dateCreated":"2026-10-30","item":[${JSON.stringify(review)}]}`);
  }
  await write("]}");
  out.end();
  await once(out, "finish");
}

beforeAll(async () => {
  workDir = await mkdtemp(join(tmpdir(), "adapter-memory-"));
  largeFile = join(workDir, "large.json");
  await generateFeed(largeFile, REVIEW_COUNT);
}, 120_000);

afterAll(async () => {
  await rm(workDir, { recursive: true, force: true });
});

describe("Data Commons adapter: memory", () => {
  it("streams a large snapshot without holding it in memory", async () => {
    const fileSize = (await stat(largeFile)).size;
    expect(fileSize).toBeGreaterThan(100 * MB);

    const baseline = retainedHeap();
    let peak = baseline;
    let count = 0;
    let malformed = 0;
    for await (const entry of dataCommonsAdapter.parse(largeFile)) {
      if (entry.kind !== "review") malformed++;
      if (++count % SAMPLE_EVERY === 0) peak = Math.max(peak, retainedHeap());
    }

    expect(count).toBe(REVIEW_COUNT);
    expect(malformed).toBe(0);
    // Loading the file with JSON.parse would retain several times the file size; streaming retains almost nothing.
    expect(peak - baseline).toBeLessThan(fileSize / 8);
  }, 120_000);
});
