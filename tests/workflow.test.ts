import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

const path = fileURLToPath(new URL("../.github/workflows/ingest.yml", import.meta.url));
const source = readFileSync(path, "utf8");

type Step = { name?: string; uses?: string; run?: string; env?: Record<string, string>; with?: Record<string, unknown> };
type Workflow = {
  name: string;
  on: { schedule?: { cron: string }[]; workflow_dispatch?: unknown };
  permissions?: Record<string, string>;
  concurrency?: { group: string; "cancel-in-progress"?: boolean };
  jobs: Record<string, { "runs-on": string; "timeout-minutes"?: number; steps: Step[] }>;
};
const workflow = parse(source) as Workflow;
const steps = Object.values(workflow.jobs).flatMap((job) => job.steps);

describe("ingest workflow", () => {
  it("runs on a weekly schedule", () => {
    const crons = workflow.on.schedule?.map((entry) => entry.cron) ?? [];
    expect(crons).toHaveLength(1);
    // minute hour day-of-month month day-of-week: a fixed day of the week, and not "every minute/hour/day".
    const [minute, hour, dayOfMonth, month, dayOfWeek] = crons[0]!.split(" ");
    expect(minute).toMatch(/^\d+$/);
    expect(hour).toMatch(/^\d+$/);
    expect([dayOfMonth, month]).toEqual(["*", "*"]);
    expect(dayOfWeek).toMatch(/^[0-6]$/);
  });

  it("can be started by hand", () => {
    expect("workflow_dispatch" in workflow.on).toBe(true);
  });

  it("runs `npm run ingest`", () => {
    expect(steps.some((step) => step.run?.trim() === "npm run ingest")).toBe(true);
  });

  it("gives the ingest step the database URL and the API key from repository secrets", () => {
    const ingest = steps.find((step) => step.run?.trim() === "npm run ingest");
    expect(ingest?.env).toEqual({
      DATABASE_URL: "${{ secrets.DATABASE_URL }}",
      GEMINI_API_KEY: "${{ secrets.GEMINI_API_KEY }}",
    });
  });

  it("keeps the secrets out of every other step", () => {
    for (const step of steps.filter((s) => s.run?.trim() !== "npm run ingest")) {
      expect(JSON.stringify(step), step.name ?? step.uses ?? step.run).not.toContain("secrets.");
    }
  });

  it("contains no secret value: every credential comes from the secrets context", () => {
    const assignments = [...source.matchAll(/^\s*(DATABASE_URL|GEMINI_API_KEY|[A-Z_]*(?:KEY|TOKEN|PASSWORD|SECRET)[A-Z_]*)\s*:\s*(.+)$/gm)];
    expect(assignments.length).toBeGreaterThan(0);
    for (const [, name, value] of assignments) expect(value!.trim(), name).toMatch(/^\$\{\{ secrets\.[A-Z_]+ \}\}$/);
    expect(source).not.toMatch(/sk-ant-|postgres(ql)?:\/\/[^\s$]*:[^\s$@]+@/);
  });

  it("asks for read-only repository access", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
  });

  it("never runs two ingestions at once", () => {
    expect(workflow.concurrency?.group).toBeTruthy();
    expect(workflow.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("has a time limit, so a hung run cannot burn runner minutes", () => {
    for (const job of Object.values(workflow.jobs)) expect(job["timeout-minutes"]).toBeGreaterThan(0);
  });

  it("uses the Node version the project pins", () => {
    const setupNode = steps.find((step) => step.uses?.startsWith("actions/setup-node"));
    expect(setupNode?.with?.["node-version-file"]).toBe(".nvmrc");
  });

  it("installs exactly what the lockfile says", () => {
    expect(steps.some((step) => step.run?.trim() === "npm ci")).toBe(true);
  });
});
