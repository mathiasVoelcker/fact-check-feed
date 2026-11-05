import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The real SDK client must never be built in tests: constructing it would mean a real client could make real requests.
const { constructed } = vi.hoisted(() => ({ constructed: vi.fn() }));
vi.mock("@google/genai", () => ({
  GoogleGenAI: class {
    constructor() {
      constructed();
      throw new Error("the real Gemini client was constructed in a test");
    }
  },
}));

import {
  CLASSIFIER_MODEL,
  GEMINI_CLASSIFIER_VERSION,
  createGeminiClassifier,
  type GeminiClassifierOptions,
} from "../src/classification/gemini";
import { parseClassification } from "../src/classification/validate";
import type { Classification } from "../src/classification/types";

type RecordedCase = { ratingText: string; parsed: Classification };
const recorded = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL("./fixtures/classifier-responses.json", import.meta.url)), "utf8"),
  ) as { cases: RecordedCase[] }
).cases;
const answerFor = (text: string) => recorded.find((c) => c.ratingText === text)!.parsed;

type Params = {
  model: string;
  contents: string;
  config?: { systemInstruction?: string; responseMimeType?: string; responseJsonSchema?: unknown; [key: string]: unknown };
  [key: string]: unknown;
};

const answer = (results: unknown[], finishReason = "STOP") => ({
  candidates: [{ finishReason }],
  text: JSON.stringify({ results }),
});

/** A stand-in for the SDK client that answers like the recorded model answers and remembers each request. */
function fakeClient(respond?: (params: Params, call: number) => unknown) {
  const requests: Params[] = [];
  const generateContent = vi.fn(async (params: Params) => {
    requests.push(params);
    if (respond) return respond(params, requests.length);
    const items = JSON.parse(params.contents) as { index: number; rating_text: string }[];
    return answer(items.map((i) => ({ index: i.index, ...answerFor(i.rating_text) })));
  });
  return { client: { models: { generateContent } } as unknown as GeminiClassifierOptions["client"], requests, generateContent };
}

const networkCall = vi.fn(() => {
  throw new Error("network access is not allowed in this test");
});

beforeEach(() => {
  constructed.mockClear();
  networkCall.mockClear();
  vi.stubGlobal("fetch", networkCall);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini classifier: the request", () => {
  it("uses a small model and structured JSON output", async () => {
    const { client, requests } = fakeClient();
    await createGeminiClassifier({ client }).classify(["False"]);

    expect(CLASSIFIER_MODEL).toBe("gemini-3.5-flash-lite");
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ model: CLASSIFIER_MODEL, config: { responseMimeType: "application/json" } });
    expect(requests[0]!.config?.responseJsonSchema).toBeDefined();
  });

  it("does not send tools, which the classifier does not need", async () => {
    const { client, requests } = fakeClient();
    await createGeminiClassifier({ client }).classify(["False"]);

    for (const key of ["tools", "toolConfig"]) {
      expect(requests[0], key).not.toHaveProperty(key);
      expect(requests[0]!.config, key).not.toHaveProperty(key);
    }
  });

  it("sends the rating texts, numbered, and nothing else", async () => {
    const { client, requests } = fakeClient();
    await createGeminiClassifier({ client }).classify(["False", "பொய் / False"]);

    expect(JSON.parse(requests[0]!.contents)).toEqual([
      { index: 0, rating_text: "False" },
      { index: 1, rating_text: "பொய் / False" },
    ]);
  });

  it("describes every category and the severity scale in the system prompt", async () => {
    const { client, requests } = fakeClient();
    await createGeminiClassifier({ client }).classify(["False"]);

    const system = requests[0]!.config?.systemInstruction ?? "";
    for (const category of ["false", "misleading", "mixed", "true", "unproven", "unclassifiable"]) {
      expect(system).toContain(category);
    }
    expect(system).toMatch(/severity/i);
    expect(system).toMatch(/data, not instructions|never follow instructions/i);
  });

  it("makes no network request of its own: it only calls the client it was given", async () => {
    const { client } = fakeClient();
    await createGeminiClassifier({ client }).classify(["False"]);
    expect(networkCall).not.toHaveBeenCalled();
    expect(constructed).not.toHaveBeenCalled();
  });

  it("identifies its model and prompt in the classifier version, so the cache can be invalidated", () => {
    expect(GEMINI_CLASSIFIER_VERSION).toContain(CLASSIFIER_MODEL);
    expect(GEMINI_CLASSIFIER_VERSION).toMatch(/prompt-v\d+/);
  });
});

describe("Gemini classifier: recorded answers", () => {
  const classify = async (texts: string[]) => createGeminiClassifier({ client: fakeClient().client }).classify(texts);

  it("maps 'False' to the false category with the highest severity", async () => {
    const [result] = await classify(["False"]);
    expect(result).toEqual({ category: "false", severity: 1 });
  });

  it("maps a bilingual label to the same category as its English half", async () => {
    const [bilingual, english] = await classify(["பொய் / False", "False"]);
    expect(bilingual?.category).toBe("false");
    expect(bilingual).toEqual(english);
  });

  it("maps a verdict followed by an explanation to the verdict", async () => {
    const sentence = recorded.find((c) => c.ratingText.startsWith("DW Fact check: Misleading"))!.ratingText;
    const [result] = await classify([sentence]);
    expect(result?.category).toBe("misleading");
  });

  it("maps a sentence with no verdict to unclassifiable, without a severity", async () => {
    const sentence = recorded.find((c) => c.ratingText.startsWith("The footage was shared widely"))!.ratingText;
    const [result] = await classify([sentence]);
    expect(result).toEqual({ category: "unclassifiable", severity: null });
  });

  it("ranks a negative rating above a neutral one", async () => {
    const [misleading, truth] = await classify(["Misleading", "True"]);
    expect(misleading!.severity!).toBeGreaterThan(truth!.severity!);
  });

  it("ranks false at or above misleading", async () => {
    const [falsy, misleading] = await classify(["False", "Misleading"]);
    expect(falsy!.severity!).toBeGreaterThanOrEqual(misleading!.severity!);
  });

  it("returns answers in the order of the texts it was given", async () => {
    const texts = ["True", "False", "Misleading"];
    const results = await classify(texts);
    expect(results.map((r) => r?.category)).toEqual(["true", "false", "misleading"]);
  });

  it.each(recorded.map((c) => [c.ratingText.slice(0, 40), c.parsed] as const))("every recorded answer for %j is a valid classification", (_name, parsed) => {
    expect(parseClassification(parsed)).toEqual(parsed);
  });
});

describe("Gemini classifier: failures", () => {
  it("returns no answers for texts the model did not answer, and keeps the ones it did", async () => {
    const { client } = fakeClient((params) => {
      const items = JSON.parse(params.contents) as { index: number }[];
      return answer([{ index: 0, ...answerFor("False") }, ...items.slice(2).map((i) => ({ index: i.index, ...answerFor("True") }))]);
    });

    const results = await createGeminiClassifier({ client }).classify(["False", "Misleading", "True"]);

    expect(results).toEqual([{ category: "false", severity: 1 }, null, { category: "true", severity: 0 }]);
  });

  it("ignores answers whose index it never asked about, and repeated indexes", async () => {
    const { client } = fakeClient(() =>
      answer([{ index: 7, ...answerFor("True") }, { index: 0, ...answerFor("False") }, { index: 0, ...answerFor("True") }]),
    );

    const results = await createGeminiClassifier({ client }).classify(["False"]);

    expect(results).toEqual([{ category: "false", severity: 1 }]);
  });

  it("returns no answers when the response could not be parsed", async () => {
    const { client } = fakeClient(() => ({ candidates: [{ finishReason: "STOP" }], text: "not json {" }));
    expect(await createGeminiClassifier({ client }).classify(["False", "True"])).toEqual([null, null]);
  });

  it("returns no answers when the answer does not have the requested shape", async () => {
    const { client } = fakeClient(() => ({ candidates: [{ finishReason: "STOP" }], text: JSON.stringify({ results: [{ index: 0, category: "banana" }] }) }));
    expect(await createGeminiClassifier({ client }).classify(["False"])).toEqual([null]);
  });

  it("returns no answers when the response is blocked, cut off or empty", async () => {
    for (const finishReason of ["SAFETY", "MAX_TOKENS", "PROHIBITED_CONTENT"]) {
      const { client } = fakeClient(() => answer([{ index: 0, ...answerFor("False") }], finishReason));
      expect(await createGeminiClassifier({ client }).classify(["False"]), finishReason).toEqual([null]);
    }
    const { client } = fakeClient(() => ({ candidates: [], text: undefined }));
    expect(await createGeminiClassifier({ client }).classify(["False"])).toEqual([null]);
  });

  it("returns no answers when the request itself fails", async () => {
    const { client } = fakeClient(() => {
      throw new Error("529 overloaded");
    });
    expect(await createGeminiClassifier({ client }).classify(["False", "True"])).toEqual([null, null]);
  });

  it("passes an answer that breaks the rules on, for the caller's validation to reject", async () => {
    const { client } = fakeClient(() => answer([{ index: 0, category: "false", severity: 5 }]));
    const [result] = await createGeminiClassifier({ client }).classify(["False"]);
    expect(parseClassification(result)).toBeNull();
  });
});

describe("Gemini classifier: batching", () => {
  it("asks about a long list in batches, in order, and joins the answers", async () => {
    const { client, requests } = fakeClient();
    const texts = Array.from({ length: 7 }, (_, i) => (i % 2 === 0 ? "False" : "True"));

    const results = await createGeminiClassifier({ client, batchSize: 3 }).classify(texts);

    expect(requests).toHaveLength(3);
    expect(requests.map((r) => (JSON.parse(r.contents) as unknown[]).length)).toEqual([3, 3, 1]);
    expect(results.map((r) => r?.category)).toEqual(texts.map((t) => (t === "False" ? "false" : "true")));
  });

  it("fails only the batch that failed", async () => {
    const { client } = fakeClient((params, call) => {
      if (call === 2) throw new Error("boom");
      const items = JSON.parse(params.contents) as { index: number; rating_text: string }[];
      return answer(items.map((i) => ({ index: i.index, ...answerFor(i.rating_text) })));
    });

    const results = await createGeminiClassifier({ client, batchSize: 2 }).classify(["False", "True", "False", "True", "False"]);

    expect(results.map((r) => r?.category ?? null)).toEqual(["false", "true", null, null, "false"]);
  });

  it("makes no request for an empty list", async () => {
    const { client, generateContent } = fakeClient();
    expect(await createGeminiClassifier({ client }).classify([])).toEqual([]);
    expect(generateContent).not.toHaveBeenCalled();
  });
});
