import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { parseAllowlist } from "../../src/allowlist/allowlist";

export type FeedServer = {
  /** `http://127.0.0.1:<port>` */
  origin: string;
  hits: { path: string; headers: IncomingHttpHeaders }[];
  /** An allowlist whose only entry is the Data Commons source, pointed at this server's `/data.json`. */
  allowlist: ReturnType<typeof parseAllowlist>;
  close(): Promise<void>;
};

/** A local stand-in for the feed host. `respond` decides the answer; by default it serves `body` as JSON. */
export async function startFeedServer(
  body: Buffer,
  respond?: (path: string) => { status: number; body?: string } | undefined,
): Promise<FeedServer> {
  const hits: FeedServer["hits"] = [];
  const server: Server = createServer((req, res) => {
    hits.push({ path: req.url ?? "", headers: req.headers });
    const override = respond?.(req.url ?? "");
    if (override) {
      res.writeHead(override.status).end(override.body ?? "");
      return;
    }
    res.writeHead(200, { "content-type": "application/json", "content-length": body.length });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    origin,
    hits,
    allowlist: parseAllowlist([
      {
        sourceId: "data-commons-claimreview",
        accessMethod: "bulk",
        license: "CC BY 4.0",
        attributionRequired: true,
        attributionText: "Data from the stub server.",
        url: `${origin}/data.json`,
      },
    ]),
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
