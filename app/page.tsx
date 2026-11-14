import { allowlist } from "../src/allowlist/allowlist";
import { getDb } from "../src/db/client";
import { countClaims, getFeedPage, getFilterChoices } from "../src/feed/claims-query";
import { Feed } from "./feed/feed";

// The feed reads the database on every request; ingestion changes it weekly, and nothing here may be built ahead of time.
export const dynamic = "force-dynamic";

const SOURCE_ID = "data-commons-claimreview";

export default async function Page() {
  const db = getDb();
  const [page, total, choices] = await Promise.all([getFeedPage(db, {}), countClaims(db, {}), getFilterChoices(db)]);
  const attribution = allowlist.get(SOURCE_ID)?.attributionText ?? "";
  const initial = {
    items: page.items,
    nextCursor: page.nextCursor ? `${page.nextCursor.publishedOn}_${page.nextCursor.id}` : null,
    total,
  };
  return <Feed initial={initial} choices={choices} attribution={attribution} />;
}
