"use client";

import type { ReactNode } from "react";

// Small, dependency-free charts for the Factory Grademix report — built to be read across a
// table by a factory owner: few marks, large labels, every bar carries its own number.

export const rs = (n: number | null | undefined) => (n == null ? "–" : Math.round(n).toLocaleString("en-US"));
export const rs2 = (n: number | null | undefined) =>
  n == null ? "–" : n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const pct = (n: number | null | undefined, d = 2) => (n == null ? "–" : `${n.toFixed(d)}%`);
export const signed = (n: number, d = 2) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(d)}`;

export interface BarSeries {
  name: string;
  color: string;
  values: (number | null)[];
}

function niceMax(v: number): { max: number; step: number } {
  if (v <= 0) return { max: 1, step: 0.25 };
  const raw = v / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { max: Math.ceil(v / step) * step, step };
}

/** Wraps a bar's own label onto up to `maxLines` short lines that fit `maxChars` each, instead
 *  of one line that gets clipped or overlaps its neighbours — a factory name reads across two
 *  lines rather than turning into an ellipsis. Breaks on spaces; a single word longer than a
 *  line is hyphen-broken as a last resort. */
function wrapLabel(label: string, maxChars: number, maxLines = 2): string[] {
  const words = label.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const pushWord = (word: string) => {
    let rest = word;
    while (rest.length > maxChars) {
      lines.push(`${rest.slice(0, Math.max(1, maxChars - 1))}-`);
      rest = rest.slice(Math.max(1, maxChars - 1));
    }
    cur = rest;
  };
  for (const word of words) {
    const candidate = cur ? `${cur} ${word}` : word;
    if (candidate.length <= maxChars) {
      cur = candidate;
    } else if (cur) {
      lines.push(cur);
      cur = "";
      if (word.length > maxChars) pushWord(word);
      else cur = word;
    } else {
      pushWord(word);
    }
  }
  if (cur) lines.push(cur);
  if (lines.length <= maxLines) return lines.length ? lines : [label];
  const kept = lines.slice(0, maxLines);
  const last = kept[maxLines - 1];
  kept[maxLines - 1] = last.length > maxChars - 1 ? `${last.slice(0, maxChars - 1)}…` : `${last}…`;
  return kept;
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-1.5" role="list">
      {items.map((s) => (
        <span key={s.name} role="listitem" className="inline-flex items-center gap-1.5 text-[12px] text-text">
          <span className="inline-block w-3 h-3 rounded-[3px]" style={{ background: s.color }} />
          {s.name}
        </span>
      ))}
    </div>
  );
}

/** Vertical grouped bars — one group per label (e.g. a month), one bar per series. */
export function GroupedBarChart({
  labels,
  series,
  highlight,
  height = 250,
  ariaLabel,
  colors,
  nameOnBar = false,
}: {
  labels: string[];
  series: BarSeries[];
  /** With a single series, one colour per bar (e.g. actual vs expected vs national). */
  colors?: string[];
  /** Index of the group to emphasise (e.g. the sale being reported). */
  highlight?: number;
  height?: number;
  ariaLabel: string;
  /** Writes each series' own name directly on its bar — for a multi-series chart where a bar's
   *  colour alone (matched back to a legend above) isn't enough to tell it apart at a glance,
   *  e.g. several factories side by side across months. Off by default: most charts here only
   *  have 1-2 series, where the shared bottom axis label already says enough. */
  nameOnBar?: boolean;
}) {
  const W = 720;
  const m = { l: 48, r: 8, t: 18, b: 26 };
  const plotW = W - m.l - m.r;
  const values = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const { max, step } = niceMax(Math.max(0, ...values) * 1.05);
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(t);
  const groupW = plotW / Math.max(1, labels.length);
  const barW = Math.min(34, (groupW * 0.78) / series.length);
  const dense = labels.length * series.length > 10;

  // Labels wrap onto up to 2 lines that fit the group's own width, so a long factory name reads
  // in full instead of being clipped or overlapping the group next to it — the chart's overall
  // height grows to fit whichever label needs the most lines, everything else stays put.
  const labelFontSize = 11;
  const labelLineHeight = 12;
  const charWidth = labelFontSize * 0.56;
  const maxChars = Math.max(4, Math.floor((groupW - 6) / charWidth));
  const wrappedLabels = labels.map((l) => wrapLabel(l, maxChars));
  const labelLines = Math.max(1, ...wrappedLabels.map((l) => l.length));
  const extraLines = labelLines - 1;
  const H = height + extraLines * labelLineHeight;
  const b = m.b + extraLines * labelLineHeight;
  const plotH = H - m.t - b;
  const y = (v: number) => m.t + plotH - (v / max) * plotH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full h-auto block">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} stroke="var(--viz-grid)" strokeWidth={1} />
          <text x={m.l - 6} y={y(t) + 3.5} textAnchor="end" fontSize={10.5} fill="var(--text-muted)">
            {rs(t)}
          </text>
        </g>
      ))}
      <line x1={m.l} x2={W - m.r} y1={y(0)} y2={y(0)} stroke="var(--viz-baseline)" strokeWidth={1} />
      {labels.map((label, gi) => {
        const gx = m.l + gi * groupW + (groupW - barW * series.length) / 2;
        const isHi = highlight === gi;
        return (
          <g key={label + gi}>
            {isHi && <rect x={m.l + gi * groupW + 2} y={m.t} width={groupW - 4} height={plotH} fill="var(--surface-sunken)" rx={4} />}
            {series.map((s, si) => {
              const v = s.values[gi];
              if (v == null) return null;
              const x = gx + si * barW;
              const barCenterX = x + barW / 2;
              const barH = y(0) - y(v);

              // The series' own name, written vertically inside its own bar — sized to the
              // bar's width and truncated to what its height can hold, so a factory's colour
              // is never the only thing telling its bars apart. Skipped when there's genuinely
              // no room (a very short or very narrow bar); the legend and hover title still
              // carry the name then.
              let barLabel: { text: string; fontSize: number } | null = null;
              if (nameOnBar) {
                const fontSize = Math.max(7, Math.min(11, Math.round(barW - 4)));
                const avail = barH - 10;
                const maxChars = Math.floor(avail / (fontSize * 0.56));
                if (maxChars >= 2) {
                  const text = s.name.length > maxChars ? `${s.name.slice(0, Math.max(1, maxChars - 1))}…` : s.name;
                  barLabel = { text, fontSize };
                }
              }

              return (
                <g key={s.name}>
                  <rect x={x + 1} y={y(v)} width={Math.max(2, barW - 2)} height={barH} rx={2} fill={colors && series.length === 1 ? colors[gi] : s.color}>
                    <title>{`${s.name}: ${rs(v)}`}</title>
                  </rect>
                  {barLabel && (
                    <text
                      x={barCenterX}
                      y={y(v) + barH / 2}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      transform={`rotate(-90 ${barCenterX} ${y(v) + barH / 2})`}
                      fontSize={barLabel.fontSize}
                      fontWeight={600}
                      fill="#fff"
                      stroke="rgba(0,0,0,0.35)"
                      strokeWidth={2}
                      paintOrder="stroke"
                    >
                      {barLabel.text}
                    </text>
                  )}
                  <text
                    x={barCenterX}
                    y={y(v) - 4}
                    textAnchor="middle"
                    fontSize={dense ? 9 : 11}
                    fontWeight={isHi ? 700 : 500}
                    fill="var(--text-strong)"
                  >
                    {dense ? Math.round(v) : rs(v)}
                  </text>
                </g>
              );
            })}
            <text x={m.l + gi * groupW + groupW / 2} textAnchor="middle" fontSize={labelFontSize} fontWeight={isHi ? 700 : 400} fill="var(--text)">
              <title>{label}</title>
              {wrappedLabels[gi].map((line, li) => (
                <tspan key={li} x={m.l + gi * groupW + groupW / 2} y={H - 8 - (wrappedLabels[gi].length - 1 - li) * labelLineHeight}>
                  {line}
                </tspan>
              ))}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Centred bars for values that can be above or below zero — each grade group's contribution
 *  to the factory average, relative to the national average. */
export function DivergingBars({ rows, format = rs2 }: { rows: { label: string; value: number; note?: ReactNode }[]; format?: (n: number) => string }) {
  const maxAbs = Math.max(1, ...rows.map((r) => Math.abs(r.value)));
  return (
    <div className="flex flex-col gap-1.5" role="list">
      {rows.map((r) => {
        const w = (Math.abs(r.value) / maxAbs) * 50;
        const positive = r.value >= 0;
        return (
          <div key={r.label} role="listitem" className="grid grid-cols-[92px_1fr_64px] items-center gap-2 text-[12px]">
            <span className="text-text truncate">{r.label}</span>
            <span className="relative h-[16px] rounded-[3px]" style={{ background: "var(--surface-sunken)" }}>
              <span className="absolute top-0 bottom-0 left-1/2 w-px" style={{ background: "var(--viz-baseline)" }} />
              <span
                className="absolute top-[2px] bottom-[2px] rounded-[2px]"
                style={{
                  background: positive ? "var(--series-3)" : "var(--series-8)",
                  width: `${w}%`,
                  left: positive ? "50%" : `${50 - w}%`,
                }}
              />
            </span>
            <span className="font-mono text-right tabular-nums text-text-strong">{format(r.value)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** Two thin bars per grade: share of the kg sold vs share of the money earned. A grade whose
 *  value bar is longer than its volume bar is pulling the average up. */
export function VolumeValueBars({ rows }: { rows: { label: string; volumePct: number; valuePct: number }[] }) {
  const max = Math.max(1, ...rows.flatMap((r) => [r.volumePct, r.valuePct]));
  return (
    <div>
      <Legend
        items={[
          { name: "Share of kg", color: "var(--series-1)" },
          { name: "Share of value", color: "var(--series-2)" },
        ]}
      />
      <div className="flex flex-col gap-1.5" role="list">
        {rows.map((r) => (
          <div key={r.label} role="listitem" className="grid grid-cols-[84px_1fr_88px] items-center gap-2 text-[11.5px]">
            <span className="text-text truncate">{r.label.toUpperCase()}</span>
            <span className="flex flex-col gap-[2px]">
              <span className="h-[6px] rounded-[2px]" style={{ background: "var(--series-1)", width: `${(r.volumePct / max) * 100}%`, minWidth: 2 }} />
              <span className="h-[6px] rounded-[2px]" style={{ background: "var(--series-2)", width: `${(r.valuePct / max) * 100}%`, minWidth: 2 }} />
            </span>
            <span className="font-mono text-right tabular-nums text-text-muted">
              {r.volumePct.toFixed(1)} / {r.valuePct.toFixed(1)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Stacked 100% bar per factory — used by the comparison to show how each grade group made up
 *  that factory's volume. */
export function StackedShare({ rows, groups }: { rows: { label: string; parts: number[] }[]; groups: { name: string; color: string }[] }) {
  return (
    <div>
      <Legend items={groups} />
      <div className="flex flex-col gap-2" role="list">
        {rows.map((r) => (
          <div key={r.label} role="listitem" className="grid grid-cols-[minmax(90px,170px)_1fr] items-center gap-3 text-[12px]">
            <span className="text-text truncate" title={r.label}>{r.label}</span>
            <span className="flex h-[22px] rounded-[4px] overflow-hidden" style={{ background: "var(--surface-sunken)" }}>
              {r.parts.map((p, i) => (
                <span
                  key={groups[i].name}
                  title={`${groups[i].name}: ${p.toFixed(1)}%`}
                  className="flex items-center justify-center text-[10.5px] font-semibold overflow-hidden"
                  style={{ width: `${p}%`, background: groups[i].color, color: "#fff" }}
                >
                  {p >= 7 ? `${p.toFixed(0)}%` : ""}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
