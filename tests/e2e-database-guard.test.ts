import { describe, expect, it } from "vitest";
import { assertLocalDatabaseUrl } from "../e2e/local-database";

describe("e2e database guard", () => {
  it.each(["localhost", "127.0.0.1", "[::1]"])("accepts a database on %s", (host) => {
    const url = `postgres://e2e:e2e@${host}:5433/e2e`;
    expect(assertLocalDatabaseUrl(url)).toBe(url);
  });

  it.each([
    ["a Neon host", "postgres://user:secret@ep-cool-name-123.us-east-2.aws.neon.tech/db?sslmode=require"],
    ["another remote host", "postgres://user:secret@db.example.com:5432/db"],
    ["a host that only starts with localhost", "postgres://user:secret@localhost.example.com/db"],
  ])("refuses %s", (_name, url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(/not a local database/i);
  });

  it.each([
    ["a missing URL", undefined],
    ["an empty URL", ""],
    ["an unparsable URL", "not a url, password=secret"],
  ])("refuses %s", (_name, url) => {
    expect(() => assertLocalDatabaseUrl(url)).toThrow(/E2E_DATABASE_URL/);
  });

  it("never prints the URL, its password or its host in the error", () => {
    const url = "postgres://user:hunter2@ep-secret-host.neon.tech/db";
    let message = "";
    try {
      assertLocalDatabaseUrl(url);
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).not.toBe("");
    for (const part of ["hunter2", "ep-secret-host", "neon.tech", url]) expect(message).not.toContain(part);
  });
});
