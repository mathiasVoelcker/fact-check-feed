const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * The e2e setup truncates and inserts, so it must only ever run against a database on this machine (design X2).
 * Returns the URL when its host is local; otherwise throws. The message never contains the URL, a password or a host.
 */
export function assertLocalDatabaseUrl(url: string | undefined): string {
  let host: string | null = null;
  try {
    host = url ? new URL(url).hostname : null;
  } catch {
    host = null;
  }
  if (host === null) throw new Error("E2E_DATABASE_URL is not set or is not a valid database URL (see tests/test-guide.md).");
  if (!LOCAL_HOSTS.has(host)) throw new Error("E2E_DATABASE_URL is not a local database; the e2e tests only run against localhost.");
  return url as string;
}
