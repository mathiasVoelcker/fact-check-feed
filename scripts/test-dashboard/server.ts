// Local test dashboard: lists every test file (vitest unit tests and Playwright e2e), groups them, runs them on
// request and shows the results. Listens on 127.0.0.1 only and runs a fixed set of commands; it never loads .env,
// so a run cannot reach Neon or Gemini unless your shell already exports those variables.
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const HTML = join(ROOT, "scripts/test-dashboard/index.html");
const OUT_DIR = join(ROOT, ".test-dashboard");
const STORE = join(OUT_DIR, "results.json");
const PORT = Number(process.env.TEST_DASHBOARD_PORT ?? 4010);
const LOG_LIMIT = 200_000;

type Status = "passed" | "failed" | "skipped";
type TestResult = { name: string; status: Status; durationMs: number; error?: string; flaky?: boolean };
type FileResult = { ranAt: string; durationMs: number; tests: TestResult[]; error?: string };
type SuiteId = "unit" | "e2e";

const SUITES: Record<SuiteId, { name: string; description: string }> = {
  unit: { name: "Unit and integration", description: "Vitest, offline: fixtures, fake classifier, PGlite" },
  e2e: { name: "End-to-end", description: "Playwright, drives the feed page in a browser" },
};

// Area per unit test file, mirroring the table in tests/test-guide.md. Unlisted files land in "Other".
const UNIT_GROUPS: Record<string, string[]> = {
  Allowlist: ["allowlist", "allowlist-guard"],
  "Database schema": ["schema"],
  "Data Commons adapter": ["data-commons-adapter", "data-commons-adapter-memory", "data-commons-fetch"],
  Filters: ["filter-required-fields", "filter-dates", "filter-entries", "text-cap", "language"],
  Classification: ["classification", "gemini-classifier"],
  "Web feed": ["feed-query", "feed-route", "feed-card", "feed-scroll", "feed-page"],
  "Whole pipeline": ["ingestion", "rating-explanation", "claim-origin", "legal", "cli"],
  "Docs and workflow": ["docs", "workflow", "spec-coverage"],
  "Setup and guards": ["placeholder", "fixtures", "e2e-database-guard"],
};

function walk(dir: string, match: RegExp): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" || entry.name === "fixtures" || entry.name === "support" ? [] : walk(path, match);
    return match.test(entry.name) ? [relative(ROOT, path).split(sep).join("/")] : [];
  });
}

function discover(): Record<SuiteId, string[]> {
  return {
    unit: walk(join(ROOT, "tests"), /\.test\.ts$/).sort(),
    e2e: walk(join(ROOT, "e2e"), /\.(spec|test)\.ts$/).sort(),
  };
}

function groupOf(suite: SuiteId, file: string): string {
  if (suite === "e2e") {
    const parts = file.split("/");
    return parts.length > 2 ? (parts[1] ?? "Feed") : "Feed";
  }
  const base = file.replace(/^tests\//, "").replace(/\.test\.ts$/, "");
  return Object.entries(UNIT_GROUPS).find(([, names]) => names.includes(base))?.[0] ?? "Other";
}

type Store = Record<SuiteId, Record<string, FileResult>>;
function loadStore(): Store {
  try {
    return JSON.parse(readFileSync(STORE, "utf8"));
  } catch {
    return { unit: {}, e2e: {} };
  }
}
function saveStore() {
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(STORE, JSON.stringify(store));
}
const store = loadStore();

type Run = {
  suite: SuiteId;
  files: string[] | "all";
  startedAt: string;
  finishedAt?: string;
  exitCode?: number | null;
  stopped?: boolean;
  message?: string;
  log: string;
};
let run: Run | undefined;
let child: ChildProcess | undefined;

// ---- result parsing -------------------------------------------------------------------------------------

const clip = (s: string | undefined) => (s ? s.replace(/\u001b\[[0-9;]*m/g, "").slice(0, 4000) : undefined);

function parseVitest(json: any, known: string[]): Record<string, FileResult> {
  const out: Record<string, FileResult> = {};
  const ranAt = new Date().toISOString();
  for (const f of json.testResults ?? []) {
    const file = relative(ROOT, f.name).split(sep).join("/");
    if (!known.includes(file)) continue;
    const tests: TestResult[] = (f.assertionResults ?? []).map((t: any) => ({
      name: t.fullName ?? t.title,
      status: t.status === "passed" ? "passed" : t.status === "failed" ? "failed" : "skipped",
      durationMs: Math.round(t.duration ?? 0),
      error: clip((t.failureMessages ?? []).join("\n")),
    }));
    if (!tests.length && f.status === "failed") {
      tests.push({ name: "File failed to run", status: "failed", durationMs: 0, error: clip(f.message) });
    }
    out[file] = { ranAt, durationMs: Math.round((f.endTime ?? 0) - (f.startTime ?? 0)), tests };
  }
  return out;
}

function parsePlaywright(json: any, known: string[]): Record<string, FileResult> {
  const out: Record<string, FileResult> = {};
  const ranAt = new Date().toISOString();
  const resolveFile = (f: string) => known.find((k) => k === f || k.endsWith("/" + f));
  const visit = (suite: any, titles: string[]) => {
    const here = suite.file ? titles : [...titles, suite.title].filter(Boolean);
    for (const spec of suite.specs ?? []) {
      const file = resolveFile(spec.file ?? suite.file);
      if (!file) continue;
      for (const t of spec.tests ?? []) {
        const last = (t.results ?? []).at(-1);
        const status: Status = t.status === "skipped" ? "skipped" : t.status === "unexpected" ? "failed" : "passed";
        const project = t.projectName ? ` [${t.projectName}]` : "";
        const entry = (out[file] ??= { ranAt, durationMs: 0, tests: [] });
        const dur = Math.round((t.results ?? []).reduce((n: number, r: any) => n + (r.duration ?? 0), 0));
        entry.durationMs += dur;
        entry.tests.push({
          name: [...here, spec.title].filter(Boolean).join(" › ") + project,
          status,
          durationMs: dur,
          flaky: t.status === "flaky",
          error: status === "failed" ? clip(last?.error?.message ?? last?.errors?.map((e: any) => e.message).join("\n")) : undefined,
        });
      }
    }
    for (const s of suite.suites ?? []) visit(s, here);
  };
  for (const s of json.suites ?? []) visit(s, []);
  return out;
}

// ---- running --------------------------------------------------------------------------------------------

/** The throwaway Postgres container from tests/test-guide.md. The e2e config still refuses any non-local database. */
const E2E_DEFAULT_DATABASE_URL = "postgres://e2e:e2e@127.0.0.1:5433/e2e";

function startRun(suite: SuiteId, files: string[] | "all") {
  mkdirSync(OUT_DIR, { recursive: true });
  const jsonPath = join(OUT_DIR, `${suite}-report.json`);
  rmSync(jsonPath, { force: true });
  const known = discover()[suite];
  const targets = files === "all" ? [] : files;
  const bin = (name: string) => join(ROOT, "node_modules/.bin", name);
  const [cmd, args, env] =
    suite === "unit"
      ? [bin("vitest"), ["run", "--reporter=json", `--outputFile=${jsonPath}`, ...targets], {}]
      : [bin("playwright"), ["test", "--reporter=json", ...targets], { PLAYWRIGHT_JSON_OUTPUT_NAME: jsonPath, E2E_DATABASE_URL: process.env.E2E_DATABASE_URL ?? E2E_DEFAULT_DATABASE_URL }];

  const r: Run = { suite, files, startedAt: new Date().toISOString(), log: `$ ${relative(ROOT, cmd)} ${args.join(" ")}\n` };
  run = r;
  const append = (b: Buffer) => {
    r.log = (r.log + b.toString()).slice(-LOG_LIMIT);
  };
  const p = spawn(cmd, args, { cwd: ROOT, env: { ...process.env, ...env, FORCE_COLOR: "0" } });
  child = p;
  p.stdout.on("data", append);
  p.stderr.on("data", append);
  p.on("error", (e) => {
    r.message = `Could not start the runner: ${e.message}`;
  });
  p.on("close", (code) => {
    r.exitCode = code;
    r.finishedAt = new Date().toISOString();
    child = undefined;
    if (r.stopped) return;
    try {
      const json = JSON.parse(readFileSync(jsonPath, "utf8"));
      const parsed = suite === "unit" ? parseVitest(json, known) : parsePlaywright(json, known);
      for (const [f, res] of Object.entries(parsed)) store[suite][f] = res;
      for (const f of json.errors?.length ? targets : []) store[suite][f] ??= { ranAt: r.finishedAt, durationMs: 0, tests: [], error: "Runner error" };
      if (json.errors?.length) r.message = clip(json.errors.map((e: any) => e.message).join("\n"));
      saveStore();
    } catch {
      r.message ??= "The runner produced no report. See the output below (for Playwright, is playwright.config.ts in place?).";
    }
  });
}

// ---- state for the page ---------------------------------------------------------------------------------

function state() {
  const found = discover();
  const suites = (Object.keys(SUITES) as SuiteId[]).map((id) => {
    const groups = new Map<string, any[]>();
    for (const file of found[id]) {
      const g = groupOf(id, file);
      const res = store[id][file];
      const list = groups.get(g) ?? [];
      list.push({ file, result: res ?? null });
      groups.set(g, list);
    }
    return {
      id,
      ...SUITES[id],
      configured: id === "unit" || ["ts", "js", "mjs"].some((e) => existsSync(join(ROOT, `playwright.config.${e}`))),
      groups: [...groups].map(([name, files]) => ({ name, files })),
    };
  });
  return { suites, run: run && { ...run, running: !run.finishedAt } };
}

// ---- http -----------------------------------------------------------------------------------------------

const readBody = (req: import("node:http").IncomingMessage) =>
  new Promise<any>((res) => {
    let s = "";
    req.on("data", (d) => (s += d));
    req.on("end", () => {
      try {
        res(JSON.parse(s || "{}"));
      } catch {
        res({});
      }
    });
  });

const server = createServer(async (req, res) => {
  const send = (code: number, body: unknown, type = "application/json") => {
    res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  // Reject cross-site requests: another web page must not be able to trigger test runs.
  const host = req.headers.host ?? "";
  if (!/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)) return send(403, { error: "forbidden" });

  if (req.method === "GET" && req.url === "/") return send(200, readFileSync(HTML, "utf8"), "text/html; charset=utf-8");
  if (req.method === "GET" && req.url === "/api/state") return send(200, state());
  if (req.method === "POST" && req.url === "/api/run") {
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== host) return send(403, { error: "forbidden" });
    if (run && !run.finishedAt) return send(409, { error: "A run is already in progress." });
    const body = await readBody(req);
    const suite: SuiteId | undefined = body.suite === "unit" || body.suite === "e2e" ? body.suite : undefined;
    if (!suite) return send(400, { error: "unknown suite" });
    let files: string[] | "all" = "all";
    if (Array.isArray(body.files) && body.files.length) {
      const known = discover()[suite];
      if (!body.files.every((f: unknown) => typeof f === "string" && known.includes(f))) return send(400, { error: "unknown file" });
      files = body.files;
    }
    startRun(suite, files);
    return send(202, { ok: true });
  }
  if (req.method === "POST" && req.url === "/api/stop") {
    if (run && !run.finishedAt && child) {
      run.stopped = true;
      run.message = "Stopped by you.";
      child.kill("SIGTERM");
    }
    return send(200, { ok: true });
  }
  if (req.method === "POST" && req.url === "/api/clear") {
    store.unit = {};
    store.e2e = {};
    saveStore();
    return send(200, { ok: true });
  }
  send(404, { error: "not found" });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(`Test dashboard: http://127.0.0.1:${PORT}`);
});
process.on("SIGINT", () => {
  child?.kill("SIGTERM");
  process.exit(0);
});
