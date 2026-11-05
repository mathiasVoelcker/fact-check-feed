import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { isNegative } from "../src/classification/negative";
import { MAX_RATING_LENGTH, classifyRatings, classifyRecords } from "../src/classification/service";
import { createClassificationStore } from "../src/classification/store";
import type { Classification, RatingClassifier } from "../src/classification/types";
import type { FilteredRecord } from "../src/pipeline/filter-entries";
import { ratingClassifications } from "../src/db/schema";
import { createTestDb } from "./support/db";

type TestDb = Awaited<ReturnType<typeof createTestDb>>;
let testDb: TestDb;

beforeAll(async () => {
  testDb = await createTestDb();
});

afterAll(async () => {
  await testDb.close();
});

beforeEach(async () => {
  await testDb.db.delete(ratingClassifications);
});

const KNOWN: Record<string, Classification> = {
  False: { category: "false", severity: 1 },
  Misleading: { category: "misleading", severity: 0.7 },
  "Half true": { category: "mixed", severity: 0.4 },
  True: { category: "true", severity: 0 },
  "No verdict here": { category: "unclassifiable", severity: null },
};

/** A classifier that answers from `answers`, and remembers every request it received. */
function fakeClassifier(answers: Record<string, Classification | null | "throw"> = KNOWN) {
  const requests: string[][] = [];
  const classifier: RatingClassifier = {
    async classify(texts) {
      requests.push([...texts]);
      return texts.map((text) => {
        const answer = answers[text];
        if (answer === "throw") throw new Error("classifier unavailable");
        return answer ?? null;
      });
    },
  };
  return { classifier, requests };
}

const store = () => createClassificationStore(testDb.db);
const VERSION = "test-v1";

const record = (overrides: Partial<FilteredRecord> = {}): FilteredRecord => ({
  url: "https://example.org/check/1",
  claimText: "A secret claim text",
  ratingText: "False",
  publisher: "Secret Publisher",
  publishedOn: "2026-10-30",
  ...overrides,
});

describe("category and severity", () => {
  it("assigns the classifier's category and severity to each rating text", async () => {
    const { classifier } = fakeClassifier();
    const { classifications } = await classifyRatings(["False", "Misleading", "True"], {
      classifier,
      store: store(),
      classifierVersion: VERSION,
    });

    expect(classifications.get("False")).toEqual({ category: "false", severity: 1 });
    expect(classifications.get("Misleading")).toEqual({ category: "misleading", severity: 0.7 });
    expect(classifications.get("True")).toEqual({ category: "true", severity: 0 });
  });

  it("gives an unclassifiable rating no severity", async () => {
    const { classifier } = fakeClassifier();
    const { classifications } = await classifyRatings(["No verdict here"], { classifier, store: store(), classifierVersion: VERSION });
    expect(classifications.get("No verdict here")).toEqual({ category: "unclassifiable", severity: null });
  });

  it("classifies the records themselves: each record gets the category and severity of its rating text", async () => {
    const { classifier } = fakeClassifier();
    const { records } = await classifyRecords(
      [record({ url: "https://example.org/1", ratingText: "False" }), record({ url: "https://example.org/2", ratingText: "True" })],
      { classifier, store: store(), classifierVersion: VERSION },
    );
    expect(records.map((r) => [r.url, r.category, r.severity])).toEqual([
      ["https://example.org/1", "false", 1],
      ["https://example.org/2", "true", 0],
    ]);
  });
});

describe("negative ratings", () => {
  it.each(["false", "misleading"] as const)("treats %s as negative", (category) => {
    expect(isNegative(category)).toBe(true);
  });

  it.each(["mixed", "true", "unproven", "unclassifiable"] as const)("does not treat %s as negative", (category) => {
    expect(isNegative(category)).toBe(false);
  });
});

describe("caching per rating text", () => {
  it("asks the classifier once per distinct text, however many records share it", async () => {
    const { classifier, requests } = fakeClassifier();
    const records = [
      ...Array.from({ length: 50 }, (_, i) => record({ url: `https://example.org/false/${i}`, ratingText: "False" })),
      record({ url: "https://example.org/m", ratingText: "Misleading" }),
    ];

    await classifyRecords(records, { classifier, store: store(), classifierVersion: VERSION });

    expect(requests).toHaveLength(1);
    expect([...requests[0]!].sort()).toEqual(["False", "Misleading"]);
  });

  it("does not ask again in a later run for a text it has already classified", async () => {
    const first = fakeClassifier();
    await classifyRatings(["False", "True"], { classifier: first.classifier, store: store(), classifierVersion: VERSION });

    const second = fakeClassifier();
    const { classifications, stats } = await classifyRatings(["False", "True"], {
      classifier: second.classifier,
      store: store(),
      classifierVersion: VERSION,
    });

    expect(second.requests).toEqual([]);
    expect(classifications.get("False")).toEqual({ category: "false", severity: 1 });
    expect(stats).toMatchObject({ distinct: 2, cached: 2, classified: 0, failed: 0 });
  });

  it("asks only about the new texts when a later run adds one", async () => {
    await classifyRatings(["False"], { classifier: fakeClassifier().classifier, store: store(), classifierVersion: VERSION });

    const second = fakeClassifier();
    await classifyRatings(["False", "Misleading"], { classifier: second.classifier, store: store(), classifierVersion: VERSION });

    expect(second.requests).toEqual([["Misleading"]]);
  });

  it("stores each result with its classifier version, one row per text", async () => {
    await classifyRatings(["False", "False", "True"], { classifier: fakeClassifier().classifier, store: store(), classifierVersion: VERSION });

    const rows = await testDb.db.select().from(ratingClassifications);
    expect(rows.map((r) => [r.ratingText, r.category, r.severity, r.classifierVersion]).sort()).toEqual([
      ["False", "false", 1, VERSION],
      ["True", "true", 0, VERSION],
    ]);
  });

  it("classifies a text again, and replaces the stored row, when the classifier version changes", async () => {
    await classifyRatings(["False"], { classifier: fakeClassifier().classifier, store: store(), classifierVersion: "v1" });

    const next = fakeClassifier({ False: { category: "false", severity: 0.95 } });
    const { classifications } = await classifyRatings(["False"], { classifier: next.classifier, store: store(), classifierVersion: "v2" });

    expect(next.requests).toEqual([["False"]]);
    expect(classifications.get("False")).toEqual({ category: "false", severity: 0.95 });
    const rows = await testDb.db.select().from(ratingClassifications);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ classifierVersion: "v2", severity: 0.95 });
  });

  it("caches an 'unclassifiable' answer, because it is a valid answer and not a failure", async () => {
    await classifyRatings(["No verdict here"], { classifier: fakeClassifier().classifier, store: store(), classifierVersion: VERSION });
    const second = fakeClassifier();
    await classifyRatings(["No verdict here"], { classifier: second.classifier, store: store(), classifierVersion: VERSION });
    expect(second.requests).toEqual([]);
  });
});

describe("classifier failure does not block ingestion", () => {
  it("stores the record as unclassifiable, does not cache it, and reports the failure", async () => {
    const { classifier } = fakeClassifier({ False: "throw" });
    const { records, stats } = await classifyRecords([record()], { classifier, store: store(), classifierVersion: VERSION });

    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ category: "unclassifiable", severity: null });
    expect(stats.failed).toBe(1);
    expect(await testDb.db.select().from(ratingClassifications)).toEqual([]);
  });

  it("retries a failed text in the next run", async () => {
    await classifyRatings(["False"], { classifier: fakeClassifier({ False: "throw" }).classifier, store: store(), classifierVersion: VERSION });

    const working = fakeClassifier();
    const { classifications } = await classifyRatings(["False"], { classifier: working.classifier, store: store(), classifierVersion: VERSION });

    expect(working.requests).toEqual([["False"]]);
    expect(classifications.get("False")).toEqual({ category: "false", severity: 1 });
  });

  it("fails only the texts the classifier could not answer", async () => {
    const { classifier } = fakeClassifier({ ...KNOWN, Misleading: null });
    const { classifications, stats } = await classifyRatings(["False", "Misleading"], { classifier, store: store(), classifierVersion: VERSION });

    expect(classifications.get("False")).toEqual({ category: "false", severity: 1 });
    expect(classifications.get("Misleading")).toEqual({ category: "unclassifiable", severity: null });
    expect(stats).toMatchObject({ classified: 1, failed: 1 });
    expect((await testDb.db.select().from(ratingClassifications)).map((r) => r.ratingText)).toEqual(["False"]);
  });

  it.each([
    ["a category outside the fixed set", { category: "maybe", severity: 0.5 }],
    ["a severity above 1", { category: "false", severity: 1.5 }],
    ["a negative severity", { category: "false", severity: -0.1 }],
    ["no severity for a classified category", { category: "false", severity: null }],
    ["a severity on an unclassifiable rating", { category: "unclassifiable", severity: 0.5 }],
    ["a severity that is not a number", { category: "false", severity: "high" }],
  ])("treats %s as a failed classification", async (_name, answer) => {
    const { classifier } = fakeClassifier({ False: answer as unknown as Classification });
    const { classifications, stats } = await classifyRatings(["False"], { classifier, store: store(), classifierVersion: VERSION });

    expect(classifications.get("False")).toEqual({ category: "unclassifiable", severity: null });
    expect(stats.failed).toBe(1);
    expect(await testDb.db.select().from(ratingClassifications)).toEqual([]);
  });

  it("treats an answer list of the wrong length as a failure of the whole request", async () => {
    const classifier: RatingClassifier = { classify: async () => [KNOWN.False!] };
    const { stats } = await classifyRatings(["False", "True"], { classifier, store: store(), classifierVersion: VERSION });
    expect(stats).toMatchObject({ classified: 0, failed: 2 });
  });
});

describe("only the rating text is sent to the classifier", () => {
  it("sends the distinct rating texts and nothing else", async () => {
    const { classifier, requests } = fakeClassifier();
    await classifyRecords(
      [
        record({ url: "https://example.org/1", claimText: "Claim one", publisher: "Publisher One", ratingText: "False" }),
        record({ url: "https://example.org/2", claimText: "Claim two", publisher: "Publisher Two", ratingText: "True" }),
      ],
      { classifier, store: store(), classifierVersion: VERSION },
    );

    const sent = JSON.stringify(requests);
    expect(requests.flat().sort()).toEqual(["False", "True"]);
    for (const secret of ["Claim one", "Claim two", "Publisher One", "Publisher Two", "example.org", "https://"]) {
      expect(sent).not.toContain(secret);
    }
  });

  it("truncates a long rating text to the maximum length before sending it", async () => {
    const long = "False. " + "The explanation goes on and on. ".repeat(100);
    expect(long.length).toBeGreaterThan(MAX_RATING_LENGTH);
    const { classifier, requests } = fakeClassifier({ [long.slice(0, MAX_RATING_LENGTH)]: KNOWN.False! });

    const { records } = await classifyRecords([record({ ratingText: long })], { classifier, store: store(), classifierVersion: VERSION });

    expect(requests).toEqual([[long.slice(0, MAX_RATING_LENGTH)]]);
    expect(records[0]).toMatchObject({ category: "false", severity: 1, ratingText: long });
  });

  it("classifies two long texts with the same beginning once, and keys the cache by the truncated text", async () => {
    const prefix = "Misleading. " + "x".repeat(MAX_RATING_LENGTH);
    const { classifier, requests } = fakeClassifier({ [prefix.slice(0, MAX_RATING_LENGTH)]: KNOWN.Misleading! });

    await classifyRecords(
      [record({ url: "https://example.org/1", ratingText: `${prefix} ending A` }), record({ url: "https://example.org/2", ratingText: `${prefix} ending B` })],
      { classifier, store: store(), classifierVersion: VERSION },
    );

    expect(requests).toHaveLength(1);
    expect(requests[0]).toHaveLength(1);
    const rows = await testDb.db.select().from(ratingClassifications);
    expect(rows.map((r) => r.ratingText)).toEqual([prefix.slice(0, MAX_RATING_LENGTH)]);
  });

  it("makes no request at all when there is nothing to classify", async () => {
    const { classifier, requests } = fakeClassifier();
    await classifyRecords([], { classifier, store: store(), classifierVersion: VERSION });
    expect(requests).toEqual([]);
  });
});
