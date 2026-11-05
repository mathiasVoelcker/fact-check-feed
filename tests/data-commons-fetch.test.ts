import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAllowlist } from "../src/allowlist/allowlist";
import { DATA_COMMONS_SOURCE_ID, createDataCommonsAdapter, deleteSnapshot } from "../src/sources/data-commons/adapter";
import { FIXTURE_PATH } from "./support/fixture";

const LIVE_HOST = "storage.googleapis.com";

type Hit = { path: string; headers: IncomingHttpHeaders };

let server: Server;
let otherServer: Server;
let baseUrl: string;
let otherHits: Hit[];
let hits: Hit[];
let fixtureBody: Buffer;
let tmpRoot: string;
const realFetch = globalThis.fetch;

function listen(handler: Parameters<typeof createServer>[1]): Promise<Server> {
  return new Promise((resolve) => {
    const s = createServer(handler);
    s.listen(0, "127.0.0.1", () => resolve(s));
  });
}

const urlOf = (s: Server) => `http://127.0.0.1:${(s.address() as AddressInfo).port}`;

beforeAll(async () => {
  fixtureBody = await readFile(FIXTURE_PATH);
  otherHits = [];
  otherServer = await listen((req, res) => {
    otherHits.push({ path: req.url ?? "", headers: req.headers });
    res.end("{}");
  });
  server = await listen((req, res) => {
    hits.push({ path: req.url ?? "", headers: req.headers });
    switch (req.url) {
      case "/ok":
        res.writeHead(200, { "content-type": "application/json", "content-length": fixtureBody.length });
        res.end(fixtureBody);
        break;
      case "/server-error":
        res.writeHead(500).end("boom");
        break;
      case "/not-found":
        res.writeHead(404).end("missing");
        break;
      case "/html":
        res.writeHead(200, { "content-type": "text/html" }).end("<html><body>Please sign in</body></html>");
        break;
      case "/empty":
        res.writeHead(200, { "content-type": "application/json", "content-length": 0 }).end();
        break;
      case "/truncated":
        res.writeHead(200, { "content-type": "application/json", "content-length": 100_000 });
        res.write(fixtureBody.subarray(0, 200));
        setTimeout(() => res.destroy(), 20);
        break;
      case "/redirect":
        res.writeHead(302, { location: `${urlOf(otherServer)}/elsewhere` }).end();
        break;
      default:
        res.writeHead(404).end();
    }
  });
  baseUrl = urlOf(server);
});

afterAll(async () => {
  await Promise.all([server, otherServer].map((s) => new Promise((resolve) => s.close(resolve))));
});

beforeEach(async () => {
  hits = [];
  otherHits.length = 0;
  tmpRoot = await mkdtemp(join(tmpdir(), "fetch-test-"));
  // Only the local stub servers may be reached; anything else (above all the live feed) fails the test.
  vi.stubGlobal("fetch", (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const href = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (new URL(href).hostname !== "127.0.0.1") throw new Error(`test attempted a real network request to ${href}`);
    return realFetch(input, init);
  });
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await rm(tmpRoot, { recursive: true, force: true });
});

function adapterFor(path: string) {
  const allowlist = parseAllowlist([
    {
      sourceId: DATA_COMMONS_SOURCE_ID,
      accessMethod: "bulk",
      license: "CC BY 4.0",
      attributionRequired: true,
      attributionText: "Data from the stub server.",
      url: `${baseUrl}${path}`,
    },
  ]);
  return createDataCommonsAdapter({ allowlist, tmpDir: tmpRoot });
}

describe("Data Commons adapter: downloading the snapshot", () => {
  it("writes the downloaded snapshot to a temporary file and returns its path", async () => {
    const path = await adapterFor("/ok").fetchSnapshot();

    expect(path.startsWith(tmpRoot)).toBe(true);
    expect(await readFile(path)).toEqual(fixtureBody);
    expect(hits).toHaveLength(1);
  });

  it("deletes the temporary file when the run is done with it", async () => {
    const path = await adapterFor("/ok").fetchSnapshot();
    expect(existsSync(path)).toBe(true);

    await deleteSnapshot(path);

    expect(existsSync(path)).toBe(false);
    expect(existsSync(dirname(path))).toBe(false);
  });

  it("only deletes directories it created itself", async () => {
    await expect(deleteSnapshot(join(tmpRoot, "precious", "file.json"))).rejects.toThrow(/snapshot/i);
  });

  it.each([
    ["/server-error", /500/],
    ["/not-found", /404/],
  ])("fails on an unsuccessful response (%s) and leaves no file behind", async (path, status) => {
    await expect(adapterFor(path).fetchSnapshot()).rejects.toThrow(status);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("fails on a response that is not JSON and leaves no file behind", async () => {
    await expect(adapterFor("/html").fetchSnapshot()).rejects.toThrow(/json/i);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("fails on an empty response", async () => {
    await expect(adapterFor("/empty").fetchSnapshot()).rejects.toThrow();
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("fails on a truncated download before anything is parsed", async () => {
    await expect(adapterFor("/truncated").fetchSnapshot()).rejects.toThrow();
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("never follows a redirect to another host", async () => {
    await expect(adapterFor("/redirect").fetchSnapshot()).rejects.toThrow();
    expect(otherHits).toEqual([]);
    expect(await readdir(tmpRoot)).toEqual([]);
  });

  it("identifies the application with a descriptive user-agent", async () => {
    await adapterFor("/ok").fetchSnapshot();

    const userAgent = hits[0]?.headers["user-agent"] ?? "";
    expect(userAgent).toMatch(/^fact-check-feed\/\d+\.\d+/);
    expect(userAgent.length).toBeGreaterThan(30);
    expect(userAgent).not.toMatch(/undici|node-fetch|Mozilla/i);
  });

  it("requests exactly the URL recorded in the allowlist entry, once", async () => {
    await adapterFor("/ok").fetchSnapshot();
    expect(hits.map((hit) => hit.path)).toEqual(["/ok"]);
  });

  it("refuses an unlisted source without any request", async () => {
    const adapter = createDataCommonsAdapter({ allowlist: parseAllowlist([]), tmpDir: tmpRoot });
    await expect(adapter.fetchSnapshot()).rejects.toThrow(/not allowlisted/);
    expect(hits).toEqual([]);
  });
});

describe("test safety", () => {
  it("blocks any request to the live feed host", async () => {
    await expect(Promise.resolve().then(() => fetch(`https://${LIVE_HOST}/anything`))).rejects.toThrow(
      /real network request/,
    );
  });
});
