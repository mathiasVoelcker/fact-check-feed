import { spawnSync } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { formatReport, runCli } from "../src/cli/ingest";
import { createDataCommonsAdapter } from "../src/sources/data-commons/adapter";
import type { RatingClassifier } from "../src/classification/types";
import { type Harness, RUN_NOW, createHarness, keywordClassifier } from "./support/ingestion";

let h: Harness;
let out: string[];
let err: string[];
const io = () => ({ log: (line: string) => void out.push(line), error: (line: string) => void err.push(line) });

beforeAll(async () => {
  h = await createHarness();
});

afterAll(async () => {
  await h.close();
});

beforeEach(async () => {
  await h.reset();
  out = [];
  err = [];
});

const deps = (overrides: Record<string, unknown> = {}) => ({
  db: h.db,
  adapter: createDataCommonsAdapter({ allowlist: h.server.allowlist, tmpDir: h.tmpDir }),
  allowlist: h.server.allowlist,
  classifier: keywordClassifier,
  classifierVersion: "test-v1",
  now: () => RUN_NOW,
  ...overrides,
});

describe("ingest CLI: a successful run", () => {
  it("prints the run report and exits 0", async () => {
    const code = await runCli({ DATABASE_URL: "postgres://unused" }, io(), deps());

    expect(code).toBe(0);
    expect(err).toEqual([]);
    const text = out.join("\n");
    expect(text).toContain("data-commons-claimreview");
    expect(text).toContain("2026-11-02");
    expect(text).toMatch(/read\D+54/i);
    expect(text).toMatch(/stored\D+27/i);
    expect(text).toMatch(/removed\D+0/i);
    for (const reason of ["malformed", "missing-claim-text", "missing-url", "missing-publisher", "invalid-date", "future-date", "outside-window", "non-english", "duplicate-url"]) {
      expect(text, reason).toContain(reason);
    }
  });

  it("writes the report to the GitHub workflow summary when there is one", async () => {
    const dir = await mkdtemp(join(tmpdir(), "summary-"));
    try {
      const summaryFile = join(dir, "summary.md");
      await runCli({ DATABASE_URL: "postgres://unused", GITHUB_STEP_SUMMARY: summaryFile }, io(), deps());

      const summary = await readFile(summaryFile, "utf8");
      expect(summary).toMatch(/^#+ /m);
      expect(summary).toMatch(/\| *stored *\| *27 *\|/i);
      expect(summary).toContain("non-english");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it("warns, but still succeeds, when some ratings could not be classified", async () => {
    const broken: RatingClassifier = { classify: async () => { throw new Error("classifier unavailable"); } };

    const code = await runCli({ DATABASE_URL: "postgres://unused" }, io(), deps({ classifier: broken }));

    expect(code).toBe(0);
    expect(out.join("\n")).toMatch(/warning[^\n]*classif[^\n]*fail/i);
    expect(out.join("\n")).toMatch(/failed\D+\d+/i);
  });
});

describe("ingest CLI: failures exit non-zero", () => {
  it("exits 1 and says why when the download fails", async () => {
    const broken = await createHarness(Buffer.from("{}"), () => ({ status: 503, body: "unavailable" }));
    try {
      const code = await runCli(
        { DATABASE_URL: "postgres://unused" },
        io(),
        { ...deps(), db: broken.db, adapter: createDataCommonsAdapter({ allowlist: broken.server.allowlist, tmpDir: broken.tmpDir }), allowlist: broken.server.allowlist },
      );
      expect(code).toBe(1);
      expect(err.join("\n")).toMatch(/503/);
    } finally {
      await broken.close();
    }
  });

  it("exits 1 when DATABASE_URL is missing, before any request", async () => {
    const code = await runCli({}, io(), { adapter: deps().adapter, allowlist: h.server.allowlist });
    expect(code).toBe(1);
    expect(err.join("\n")).toContain("DATABASE_URL");
    expect(h.server.hits).toEqual([]);
  });
});

describe("ingest CLI: the report text", () => {
  it("lists a count for every exclusion reason, including zeros", async () => {
    const report = await h.ingest();
    const text = formatReport(report);
    for (const reason of Object.keys(report.excluded)) expect(text).toContain(reason);
  });
});

describe("ingest CLI: the real script", () => {
  const root = fileURLToPath(new URL("..", import.meta.url));
  const run = (env: Record<string, string>) =>
    spawnSync(process.execPath, ["--import", "tsx", "scripts/ingest.ts"], { cwd: root, env: { PATH: process.env.PATH ?? "", HOME: process.env.HOME ?? "", NODE_ENV: "test", ...env }, encoding: "utf8", timeout: 60_000 });

  it("exits non-zero and names the missing setting when DATABASE_URL is not set", () => {
    const result = run({});
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("DATABASE_URL");
  });
});
