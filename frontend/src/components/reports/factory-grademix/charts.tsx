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
}: {
  labels: string[];
  series: BarSeries[];
  /** With a single series, one colour per bar (e.g. actual vs expected vs national). */
  colors?: string[];
  /** Index of the group to emphasise (e.g. the sale being reported). */
  highlight?: number;
  height?: number;
  ariaLabel: string;
}) {
  const W = 720;
  const H = height;
  const m = { l: 48, r: 8, t: 18, b: 26 };
  const plotW = W - m.l - m.r;
  const plotH = H - m.t - m.b;
  const values = series.flatMap((s) => s.values).filter((v): v is number => v != null);
  const { max, step } = niceMax(Math.max(0, ...values) * 1.05);
  const ticks: number[] = [];
  for (let t = 0; t <= max + 1e-9; t += step) ticks.push(t);
  const groupW = plotW / Math.max(1, labels.length);
  const barW = Math.min(34, (groupW * 0.78) / series.length);
  const y = (v: number) => m.t + plotH - (v / max) * plotH;
  const dense = labels.length * series.length > 10;

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
              return (
                <g key={s.name}>
                  <rect x={x + 1} y={y(v)} width={Math.max(2, barW - 2)} height={y(0) - y(v)} rx={2} fill={colors && series.length === 1 ? colors[gi] : s.color} />
                  <text
                    x={x + barW / 2}
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
            <text
              x={m.l + gi * groupW + groupW / 2}
              y={H - 8}
              textAnchor="middle"
              fontSize={11}
              fontWeight={isHi ? 700 : 400}
              fill="var(--text)"
            >
              {label}
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
