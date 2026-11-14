import { isHttpUrl } from "../../src/pipeline/filters";
import type { FeedCard } from "../../src/feed/claims-query";
import { originLabel } from "../../src/feed/origin-label";

const CATEGORY_COLORS: Record<string, string> = {
  false: "#b71c1c", misleading: "#c25e00", mixed: "#7a6200", true: "#1b6e2d", unproven: "#455a64", unclassifiable: "#616161",
};

/** The host of an http(s) URL, or null when the value must not be linked (the same test ingestion applies). */
function safeHost(url: string | null): string | null {
  if (!url || !isHttpUrl(url)) return null;
  return new URL(url).host;
}

/** Where the claim appeared. Always labeled as the claim itself and never as a source (E7); never requested by the server. */
function Origin({ claim }: { claim: FeedCard }) {
  if (!claim.originalUrl && !claim.originalVenue && !claim.originalAuthor) return null;
  const label = originLabel(claim.category);
  const host = safeHost(claim.originalUrl);
  const who = [claim.originalAuthor, claim.originalVenue].filter(Boolean).join(" · ");
  return (
    <div data-block="origin" style={{ margin: "0 0 10px", padding: "8px 10px", border: "1px dashed #8a1c1c", background: "#fbf1f0", fontSize: 14 }}>
      <strong>{label.heading}</strong>
      <div style={{ fontSize: 13 }}>{label.line}</div>
      {who && <div>{who}</div>}
      {host && claim.originalUrl && (
        <a
          data-link="original-claim"
          href={claim.originalUrl}
          target="_blank"
          rel="noopener noreferrer nofollow"
          style={{ fontFamily: "monospace", fontSize: 12, color: "#8a1c1c" }}
        >
          {`⚠ ${host} (not a source)`}
        </a>
      )}
    </div>
  );
}

export function ClaimCard({ claim }: { claim: FeedCard }) {
  const color = CATEGORY_COLORS[claim.category] ?? "#616161";
  return (
    <article style={{ border: "1px solid #ccc", borderLeft: `6px solid ${color}`, borderRadius: 6, padding: 14 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
        <span data-badge={claim.category} style={{ background: color, color: "#fff", borderRadius: 4, padding: "2px 8px", fontSize: 12 }}>
          {claim.category}
        </span>
        <span style={{ color: "#555", fontSize: 13 }}>rated “{claim.ratingText}”</span>
      </div>
      <p style={{ margin: "4px 0 8px", fontSize: 17 }}>{claim.claimText}</p>
      {claim.ratingExplanation && (
        <p style={{ margin: "0 0 10px", fontSize: 14, whiteSpace: "pre-line" }}>
          <strong>Why: </strong>
          {claim.ratingExplanation}
        </p>
      )}
      <Origin claim={claim} />
      <div style={{ color: "#555", fontSize: 13 }}>
        {claim.publisher} · {claim.publishedOn} ·{" "}
        <a data-link="fact-check" href={claim.url} target="_blank" rel="noopener noreferrer">
          {claim.ratingExplanation ? "Read the full fact-check" : `Read why at ${claim.publisher}`}
        </a>
      </div>
    </article>
  );
}
