import { RATING_CATEGORIES, type RatingCategory } from "../db/schema";
import type { Database } from "../db/types";
import { type Cursor, type FeedFilters, countClaims, getFeedPage } from "./claims-query";

/** The longest search text the route accepts. */
export const MAX_SEARCH_LENGTH = 200;
const MAX_PUBLISHER_LENGTH = 300;
const MAX_ID = 2_147_483_647;

const bad = (error: string) => Response.json({ error }, { status: 400, headers: { "cache-control": "no-store" } });

/** The cursor travels as `YYYY-MM-DD_id`; anything else, including an impossible date, is refused. */
function parseCursor(value: string): Cursor | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})_(\d{1,10})$/.exec(value);
  if (!match) return null;
  const [year, month, day, id] = [Number(match[1]), Number(match[2]), Number(match[3]), Number(match[4])] as [number, number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  const real = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  if (!real || id < 1 || id > MAX_ID) return null;
  return { publishedOn: `${match[1]}-${match[2]}-${match[3]}`, id };
}

const formatCursor = (cursor: Cursor) => `${cursor.publishedOn}_${cursor.id}`;

/**
 * Serves one page of the feed for `GET /api/claims?q=&category=&publisher=&cursor=`. The order and the page size are not
 * parameters. The total is counted on a first page only; later pages leave it null. Nothing here requests any URL.
 */
export async function handleClaimsRequest(db: Database, url: URL): Promise<Response> {
  const params = url.searchParams;
  const search = params.get("q") ?? "";
  if (search.length > MAX_SEARCH_LENGTH) return bad("The search is too long.");

  const filters: FeedFilters = { search };
  const category = params.get("category");
  if (category) {
    if (!(RATING_CATEGORIES as readonly string[]).includes(category)) return bad("Unknown rating category.");
    filters.category = category as RatingCategory;
  }
  const publisher = params.get("publisher");
  if (publisher) {
    if (publisher.length > MAX_PUBLISHER_LENGTH) return bad("The publisher is too long.");
    filters.publisher = publisher;
  }

  const rawCursor = params.get("cursor");
  const cursor = rawCursor ? parseCursor(rawCursor) : undefined;
  if (rawCursor && !cursor) return bad("The cursor is not valid.");

  const [page, total] = await Promise.all([getFeedPage(db, filters, cursor ?? undefined), cursor ? Promise.resolve(null) : countClaims(db, filters)]);
  return Response.json(
    { items: page.items, nextCursor: page.nextCursor ? formatCursor(page.nextCursor) : null, total },
    { headers: { "cache-control": "no-store" } },
  );
}
