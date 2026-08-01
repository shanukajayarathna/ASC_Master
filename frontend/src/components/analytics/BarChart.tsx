"use client";

import Tooltip from "@mui/material/Tooltip";

export interface BarChartRow {
  label: string;
  /** Drives bar length, relative to the largest value in the chart. */
  value: number;
  /** What's shown at the end of the bar — already formatted (currency, count, %, …). */
  displayValue: string;
  /** Per-row color for a categorical chart (e.g. classification tiers). Omit for a
   *  single-series ranking, where every bar uses `accentColor` instead. */
  color?: string;
  /** Extra detail shown in the hover tooltip, beyond label + displayValue. */
  detail?: string;
}

/**
 * The one chart primitive this app has (see the Phase 6 plan for why no charting library
 * was added) — a horizontal bar ranking, per the dataviz skill's mark spec: thin bars,
 * rounded data-end, a visible gap between bars, a value label, and a hover tooltip on every
 * bar. `legend` is shown only for a categorical chart (color varies per row) — a single-series
 * chart needs no legend box, since its own title already names the one series.
 */
export default function BarChart({
  rows,
  accentColor = "var(--brand-gold)",
  legend,
}: {
  rows: BarChartRow[];
  accentColor?: string;
  legend?: { label: string; color: string }[];
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));

  return (
    <div>
      {legend && (
        <div className="flex flex-wrap gap-x-4 gap-y-1.5 mb-3">
          {legend.map((l) => (
            <div key={l.label} className="flex items-center gap-1.5 text-[11.5px] text-text-muted">
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      )}
      <div className="flex flex-col gap-2.5">
        {rows.map((row) => (
          <Tooltip key={row.label} title={row.detail ?? `${row.label}: ${row.displayValue}`} placement="top" arrow>
            <div>
              <div className="flex items-baseline justify-between gap-2 mb-1">
                <span className="text-[13px] text-text truncate">{row.label}</span>
                <span className="text-[12.5px] font-mono text-text-muted shrink-0">{row.displayValue}</span>
              </div>
              <div className="h-2 rounded-full bg-surface-sunken overflow-hidden">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${Math.max(2, (row.value / max) * 100)}%`,
                    background: row.color ?? accentColor,
                  }}
                />
              </div>
            </div>
          </Tooltip>
        ))}
      </div>
    </div>
  );
}
