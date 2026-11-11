"use client";
// PROTOTYPE: three radically different feed layouts over the same rows. Filters are client state only.
import { useMemo, useState } from "react";
import type { Row } from "./page";

const COLORS: Record<string, string> = {
  false: "#c62828", misleading: "#ef6c00", mixed: "#8d6e00", true: "#2e7d32", unproven: "#546e7a", unclassifiable: "#888",
};

const badge = (c: string) => ({
  background: COLORS[c] ?? "#888", color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 12, whiteSpace: "nowrap" as const,
});

function useFilters(rows: Row[]) {
  const [category, setCategory] = useState("all");
  const [publisher, setPublisher] = useState("all");
  const [sort, setSort] = useState<"newest" | "severity">("newest");
  const categories = useMemo(() => [...new Set(rows.map((r) => r.category))], [rows]);
  const publishers = useMemo(() => [...new Set(rows.map((r) => r.publisher))].sort(), [rows]);
  const shown = useMemo(() => {
    const out = rows.filter((r) => (category === "all" || r.category === category) && (publisher === "all" || r.publisher === publisher));
    return sort === "severity" ? [...out].sort((a, b) => (b.severity ?? -1) - (a.severity ?? -1) || b.published_on.localeCompare(a.published_on)) : out;
  }, [rows, category, publisher, sort]);
  const bar = (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", margin: "16px 0" }}>
      <select value={category} onChange={(e) => setCategory(e.target.value)}>
        <option value="all">All ratings</option>
        {categories.map((c) => <option key={c}>{c}</option>)}
      </select>
      <select value={publisher} onChange={(e) => setPublisher(e.target.value)}>
        <option value="all">All publishers</option>
        {publishers.map((p) => <option key={p}>{p}</option>)}
      </select>
      <select value={sort} onChange={(e) => setSort(e.target.value as "newest" | "severity")}>
        <option value="newest">Newest first</option>
        <option value="severity">Most severe first</option>
      </select>
      <span style={{ color: "#666", alignSelf: "center" }}>{shown.length} shown</span>
    </div>
  );
  return { shown, bar };
}

/** Variant A: card feed, claim first, rating badge, publisher and date as metadata. */
export function Cards({ rows }: { rows: Row[] }) {
  const { shown, bar } = useFilters(rows);
  return (
    <>
      {bar}
      <div style={{ display: "grid", gap: 12 }}>
        {shown.slice(0, 50).map((r) => (
          <article key={r.id} style={{ border: "1px solid #ddd", borderLeft: `6px solid ${COLORS[r.category]}`, borderRadius: 6, padding: 14 }}>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span style={badge(r.category)}>{r.category}</span>
              <span style={{ color: "#666", fontSize: 13 }}>rated "{r.rating_text}"</span>
            </div>
            <p style={{ margin: "4px 0 8px", fontSize: 17 }}>{r.claim_text}</p>
            {r.rating_explanation && (
              <p style={{ margin: "0 0 8px", fontSize: 14, color: "#333", background: "#f6f6f6", padding: "8px 10px", borderRadius: 4, whiteSpace: "pre-line" }}>
                <strong>Why: </strong>
                {r.rating_explanation}
              </p>
            )}
            <div style={{ color: "#666", fontSize: 13 }}>
              {r.publisher} · {r.published_on} ·{" "}
              <a href={r.url} rel="noopener noreferrer" target="_blank">
                {r.rating_explanation ? "Read the full fact-check" : `Read why at ${r.publisher}`}
              </a>
            </div>
          </article>
        ))}
      </div>
    </>
  );
}

/** Variant B: dense table, scan many at once. */
export function Table({ rows }: { rows: Row[] }) {
  const { shown, bar } = useFilters(rows);
  return (
    <>
      {bar}
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
        <thead>
          <tr style={{ textAlign: "left", borderBottom: "2px solid #333" }}>
            <th>Date</th><th>Rating</th><th>Claim</th><th>Publisher</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.id} style={{ borderBottom: "1px solid #eee", verticalAlign: "top" }}>
              <td style={{ padding: "6px 8px 6px 0", whiteSpace: "nowrap" }}>{r.published_on}</td>
              <td style={{ padding: 6 }}><span style={badge(r.category)}>{r.category}</span></td>
              <td style={{ padding: 6 }}>
                <a href={r.url} rel="noopener noreferrer" target="_blank">{r.claim_text}</a>
                {r.rating_explanation && (
                  <details style={{ marginTop: 4, color: "#444" }}>
                    <summary style={{ cursor: "pointer", color: "#666", fontSize: 12 }}>Why?</summary>
                    <div style={{ whiteSpace: "pre-line", fontSize: 13, paddingTop: 4 }}>{r.rating_explanation}</div>
                  </details>
                )}
              </td>
              <td style={{ padding: 6, color: "#666" }}>{r.publisher}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** Variant C: grouped by week, a "this week" digest with a rating breakdown per week. */
export function Grouped({ rows }: { rows: Row[] }) {
  const { shown, bar } = useFilters(rows);
  const weeks = useMemo(() => {
    const map = new Map<string, Row[]>();
    for (const r of shown) {
      const d = new Date(r.published_on + "T00:00:00Z");
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
      const key = d.toISOString().slice(0, 10);
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return [...map.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [shown]);
  return (
    <>
      {bar}
      {weeks.map(([week, items]) => {
        const counts = items.reduce<Record<string, number>>((m, r) => ({ ...m, [r.category]: (m[r.category] ?? 0) + 1 }), {});
        return (
          <section key={week} style={{ marginBottom: 28 }}>
            <h2 style={{ margin: "0 0 6px" }}>Week of {week}</h2>
            <div style={{ display: "flex", height: 8, borderRadius: 4, overflow: "hidden", marginBottom: 6 }}>
              {Object.entries(counts).map(([c, n]) => <div key={c} style={{ flex: n, background: COLORS[c] }} title={`${c}: ${n}`} />)}
            </div>
            <div style={{ color: "#666", fontSize: 13, marginBottom: 8 }}>
              {items.length} fact-checks · {Object.entries(counts).map(([c, n]) => `${n} ${c}`).join(", ")}
            </div>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {items.slice(0, 8).map((r) => (
                <li key={r.id} style={{ marginBottom: 4 }}>
                  <span style={badge(r.category)}>{r.category}</span>{" "}
                  <a href={r.url} rel="noopener noreferrer" target="_blank">{r.claim_text}</a>{" "}
                  <span style={{ color: "#888", fontSize: 12 }}>{r.publisher}</span>
                  {r.rating_explanation && (
                    <div style={{ color: "#555", fontSize: 13, margin: "2px 0 0" }}>
                      {r.rating_explanation.replace(/\s+/g, " ").slice(0, 160)}
                      {r.rating_explanation.length > 160 ? "…" : ""}
                    </div>
                  )}
                </li>
              ))}
            </ul>
            {items.length > 8 && <div style={{ color: "#888", fontSize: 13 }}>+ {items.length - 8} more</div>}
          </section>
        );
      })}
    </>
  );
}
