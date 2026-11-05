import { createWriteStream } from "node:fs";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

const SNAPSHOT_DIR_PREFIX = "snapshot-";
const OPEN_BRACE = 0x7b;

export type DownloadOptions = {
  userAgent: string;
  /** Directory the snapshot directory is created in; defaults to the OS temp directory. */
  tmpDir?: string;
};

/** Passes bytes through, failing unless the content starts like a JSON object. */
function expectJsonObject(): Transform {
  let checked = false;
  return new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      if (!checked) {
        const first = chunk.find((byte) => byte !== 0x20 && byte !== 0x0a && byte !== 0x0d && byte !== 0x09);
        if (first === undefined) return callback(null, chunk);
        if (first !== OPEN_BRACE) return callback(new Error("Feed download is not JSON"));
        checked = true;
      }
      callback(null, chunk);
    },
    flush(callback) {
      callback(checked ? null : new Error("Feed download is empty or not JSON"));
    },
  });
}

/**
 * Downloads the snapshot into its own temporary directory and returns the file path.
 * A failed, redirected, empty, non-JSON or truncated download throws and leaves nothing behind,
 * so the run fails before any record is processed.
 */
export async function downloadSnapshot(url: string, { userAgent, tmpDir = tmpdir() }: DownloadOptions): Promise<string> {
  const dir = await mkdtemp(join(tmpDir, SNAPSHOT_DIR_PREFIX));
  const file = join(dir, "snapshot.json");
  try {
    const response = await fetch(url, {
      headers: { "user-agent": userAgent, accept: "application/json" },
      // A redirect could lead to a host other than the allowlisted one.
      redirect: "error",
    });
    if (!response.ok) throw new Error(`Feed download failed: HTTP ${response.status}`);
    if (!response.body) throw new Error("Feed download failed: the response has no body");

    // fetch's body is typed as the DOM ReadableStream; at runtime it is the Node web stream.
    const body = Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>);
    await pipeline(body, expectJsonObject(), createWriteStream(file));

    // Content-Length counts the compressed bytes when the response is encoded, so compare only when it is not.
    const expected = Number(response.headers.get("content-length"));
    if (!response.headers.has("content-encoding") && Number.isFinite(expected) && expected > 0) {
      const written = (await stat(file)).size;
      if (written !== expected) {
        throw new Error(`Feed download was truncated: received ${written} of ${expected} bytes`);
      }
    }
    return file;
  } catch (error) {
    await rm(dir, { recursive: true, force: true });
    throw error;
  }
}

/** Removes a snapshot returned by `downloadSnapshot`, together with its directory. */
export async function deleteSnapshot(path: string): Promise<void> {
  const dir = dirname(path);
  if (!basename(dir).startsWith(SNAPSHOT_DIR_PREFIX)) {
    throw new Error(`Refusing to delete "${path}": it is not inside a snapshot directory`);
  }
  await rm(dir, { recursive: true, force: true });
}
