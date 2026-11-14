import { and, asc, count, desc, eq, ilike, or, sql, type SQL } from "drizzle-orm";
import { RATING_CATEGORIES, claims, type RatingCategory } from "../db/schema";
import type { Database } from "../db/types";

/** Claims per page of the feed (spec: cards load 50 at a time). */
export const PAGE_SIZE = 50;

export type FeedFilters = {
  search?: string;
  category?: RatingCategory;
  publisher?: string;
};

/** Where the next page starts: the last shown (review date, id). The feed's order is total on this pair (design U2). */
export type Cursor = { publishedOn: string; id: number };

/** Exactly what a card shows; no other stored field leaves the database layer. */
export type FeedCard = {
  id: number;
  url: string;
  claimText: string;
  ratingText: string;
  ratingExplanation: string | null;
  originalUrl: string | null;
  originalVenue: string | null;
  originalAuthor: string | null;
  publisher: string;
  publishedOn: string;
  category: RatingCategory;
};

export type FeedPage = { items: FeedCard[]; nextCursor: Cursor | null };

const cardColumns = {
  id: claims.id,
  url: claims.url,
  claimText: claims.claimText,
  ratingText: claims.ratingText,
  ratingExplanation: claims.ratingExplanation,
  originalUrl: claims.originalUrl,
  originalVenue: claims.originalVenue,
  originalAuthor: claims.originalAuthor,
  publisher: claims.publisher,
  publishedOn: claims.publishedOn,
  category: claims.category,
};

/** Makes `%`, `_` and the escape character match only themselves inside an ILIKE pattern. */
const escapeLike = (word: string) => word.replace(/[\\%_]/g, "\\$&");

function where({ search, category, publisher }: FeedFilters): SQL | undefined {
  const words = (search ?? "").split(/\s+/).filter(Boolean);
  const conditions: (SQL | undefined)[] = words.map((word) => {
    const pattern = `%${escapeLike(word)}%`;
    return or(
      ilike(claims.claimText, pattern),
      ilike(claims.ratingText, pattern),
      ilike(claims.ratingExplanation, pattern),
      ilike(claims.publisher, pattern),
      ilike(claims.originalAuthor, pattern),
    );
  });
  if (category) conditions.push(eq(claims.category, category));
  if (publisher) conditions.push(eq(claims.publisher, publisher));
  return and(...conditions);
}

/** One page of the feed: newest review date first, `id` breaking ties, starting after `cursor` when given. */
export async function getFeedPage(db: Database, filters: FeedFilters, cursor?: Cursor): Promise<FeedPage> {
  const after = cursor ? sql`(${claims.publishedOn}, ${claims.id}) < (${cursor.publishedOn}::date, ${cursor.id}::integer)` : undefined;
  const rows = await db
    .select(cardColumns)
    .from(claims)
    .where(and(where(filters), after))
    .orderBy(desc(claims.publishedOn), desc(claims.id))
    .limit(PAGE_SIZE + 1);
  const items = rows.slice(0, PAGE_SIZE);
  const last = items.at(-1);
  return { items, nextCursor: rows.length > PAGE_SIZE && last ? { publishedOn: last.publishedOn, id: last.id } : null };
}

/** How many claims match, across all pages. */
export async function countClaims(db: Database, filters: FeedFilters): Promise<number> {
  const [row] = await db.select({ total: count() }).from(claims).where(where(filters));
  return Number(row?.total ?? 0);
}

/** The publishers and categories present in the stored claims, for the filter dropdowns. */
export async function getFilterChoices(db: Database): Promise<{ publishers: string[]; categories: RatingCategory[] }> {
  const publishers = await db.select({ publisher: claims.publisher }).from(claims).groupBy(claims.publisher).orderBy(sql`lower(${claims.publisher})`, asc(claims.publisher));
  const present = await db.selectDistinct({ category: claims.category }).from(claims);
  const set = new Set(present.map((r) => r.category));
  return { publishers: publishers.map((r) => r.publisher), categories: RATING_CATEGORIES.filter((c) => set.has(c)) };
}
