import { type AccessMethod, type Allowlist, type AllowlistEntry, allowlist as defaultAllowlist } from "./allowlist";

export class SourceNotAllowlistedError extends Error {
  constructor(sourceId: string) {
    super(`Source "${sourceId}" is not allowlisted`);
    this.name = "SourceNotAllowlistedError";
  }
}

export type AccessHandlers<T> = Partial<Record<AccessMethod, (entry: AllowlistEntry) => Promise<T>>>;

/**
 * Looks the source up in the allowlist and runs only the handler for its recorded access method.
 * An unlisted source is refused before any handler runs, so no request can be made for it.
 */
export async function fetchAllowlistedSource<T>(
  sourceId: string,
  handlers: AccessHandlers<T>,
  allowlist: Allowlist = defaultAllowlist,
): Promise<T> {
  const entry = allowlist.get(sourceId);
  if (!entry) throw new SourceNotAllowlistedError(sourceId);

  const handler = handlers[entry.accessMethod];
  if (!handler) {
    throw new Error(`Source "${entry.sourceId}" is recorded with access method "${entry.accessMethod}", which has no handler`);
  }
  return handler(entry);
}
