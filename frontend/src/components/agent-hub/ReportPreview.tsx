"use client";

import ChartBlock from "@/components/assistant/ChartBlock";
import { ChatTable } from "@/components/assistant/RichText";
import type { CustomPreview } from "@/types/api";
import { BROKER_CHIPS, SOURCE_LINE, chartSpecFrom, summarize, tableRows, type VisualKey } from "./reportBuilder";

interface ReportPreviewProps {
  preview: CustomPreview | null;
  loading: boolean;
  error: string | null;
  visual: VisualKey;
}

/**
 * The centre pane: the report as a paper page — title, subtitle (the scope the query actually used), broker
 * legend, the chosen visual, a summary block and the source line. All figures come from the archive query;
 * while it loads (or if it fails) the page shows clearly labelled placeholder shapes, never invented numbers.
 */
export default function ReportPreview({ preview, loading, error, visual }: ReportPreviewProps) {
  const spec = preview ? chartSpecFrom(preview, visual) : null;
  const inView = new Set([...(preview?.categories ?? []), ...(preview?.series.map((s) => s.name) ?? [])]);
  const legend = BROKER_CHIPS.filter((b) => inView.has(b.code));
  const summary = preview ? summarize(preview) : [];

  return (
    <article className="ws-paper" aria-label="Report preview" aria-busy={loading}>
      {!preview ? (
        <div className="ws-paper-placeholder" role={error ? "alert" : "status"}>
          <div className="ws-ph-bar ws-ph-title" aria-hidden="true" />
          <div className="ws-ph-bar ws-ph-sub" aria-hidden="true" />
          <div className="ws-ph-chart" aria-hidden="true">
            {[60, 85, 45, 70, 35, 55].map((h, i) => (
              <span key={i} style={{ height: `${h}%` }} />
            ))}
          </div>
          <p className="ws-ph-note">
            {error ?? (loading ? "Placeholder — loading the figures from the archive…" : "Placeholder — choose what to show.")}
          </p>
        </div>
      ) : (
        <>
          <header className="ws-paper-head">
            <h2 className="ws-paper-title">{preview.title}</h2>
            <p className="ws-paper-sub">{preview.scope}</p>
            {legend.length > 0 && (
              <ul className="ws-paper-legend" aria-label="Brokers">
                {legend.map((b) => (
                  <li key={b.code}>
                    <span className="ws-broker-dot" style={{ background: b.color }} aria-hidden="true" />
                    {b.code} <span className="ws-paper-legend-name">{b.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </header>

          <div className="ws-paper-body" style={{ opacity: loading ? 0.55 : 1 }}>
            {preview.categories.length === 0 ? (
              <p className="ws-ph-note" role="status">
                No figures for this selection. The sale may not have results in the archive yet — try a wider period, another sale, or fewer filters.
              </p>
            ) : spec ? <ChartBlock spec={spec} /> : <ChatTable rows={tableRows(preview).map((r) => r.map((c) => (typeof c === "number" ? c.toLocaleString(undefined, { maximumFractionDigits: 2 }) : (c ?? "—"))))} />}
          </div>

          {summary.length > 0 && (
            <ul className="ws-paper-summary" aria-label="Summary">
              {summary.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          )}
          <footer className="ws-paper-foot">{SOURCE_LINE}</footer>
        </>
      )}
    </article>
  );
}
