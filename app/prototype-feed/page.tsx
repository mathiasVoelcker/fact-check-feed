// PROTOTYPE: throwaway. Answers "what should the feed look like?". Reads a static snapshot of the real claims table.
// Run: npm run dev, open /prototype-feed?variant=cards (cards | table | grouped). Wipe this directory when done.
import snapshot from "./snapshot.json";
import { VariantBar } from "./variant-bar";
import { Cards, Grouped, Table } from "./variants";

export type Row = {
  id: number;
  url: string;
  claim_text: string;
  rating_text: string;
  publisher: string;
  published_on: string;
  category: string;
  severity: number | null;
};

const VARIANTS = ["cards", "table", "grouped"] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ variant?: string }> }) {
  const { variant: v } = await searchParams;
  const variant = VARIANTS.find((x) => x === v) ?? "cards";
  const rows = snapshot as Row[];

  return (
    <main style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px 96px", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ marginBottom: 4 }}>Fact-check feed</h1>
      <p style={{ color: "#666", marginTop: 0 }}>
        {rows.length} fact-checks from the last 90 days. Data: Data Commons ClaimReview (CC BY 4.0).
      </p>
      {variant === "cards" && <Cards rows={rows} />}
      {variant === "table" && <Table rows={rows} />}
      {variant === "grouped" && <Grouped rows={rows} />}
      <VariantBar variants={[...VARIANTS]} current={variant} />
    </main>
  );
}
