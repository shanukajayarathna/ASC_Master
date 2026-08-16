"use client";

import { brokerCode, brokerColorVar, brokerName, brokerPaletteCss } from "@/lib/brokers";
import type { FilteredSectionRow } from "@/types/api";
import Tooltip from "@mui/material/Tooltip";
import { useMemo } from "react";

/* =====================================================================
   BROKER CHARTS — the portal's two signature visuals, rebuilt per the
   dataviz method:
   • Donut: broker-wise catalogue quantity, center total, 2px surface
     gaps between slices, direct % labels, full legend with values.
   • Vertical bars: broker-wise weighted average with a dashed Total AVG
     reference line and visible value labels.
   Colors are the validated 8-slot categorical palette (light+dark runs
   both PASS on this app's surfaces) and follow the BROKER, never the
   rank — AS is always blue no matter how the filter reorders sizes.
   ===================================================================== */

const nf = new Intl.NumberFormat("en-US");
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const mkg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : nf.format(Math.round(v)));

/** Per-broker CSS color (company palette), adapting to the app's dark mode. */
function BrokerPaletteStyle() {
  return <style>{brokerPaletteCss()}</style>;
}

export function BrokerDonut({ rows }: { rows: FilteredSectionRow[] }) {
  const data = useMemo(
    () => rows.filter((r) => r.totalQtyKg > 0).sort((a, b) => b.totalQtyKg - a.totalQtyKg),
    [rows]
  );
  const total = data.reduce((s, r) => s + r.totalQtyKg, 0);
  if (total === 0) return <p className="text-[12px] text-text-muted m-0">Nothing in this slice.</p>;

  const size = 240, cx = size / 2, cy = size / 2, rOuter = 108, rInner = 66;
  // Pre-accumulate slice angles (render-pure: no mutation during map).
  const fracs = data.map((r) => r.totalQtyKg / total);
  const starts = fracs.reduce<number[]>((acc, f, i) => {
    acc.push(i === 0 ? -Math.PI / 2 : acc[i - 1] + fracs[i - 1] * 2 * Math.PI);
    return acc;
  }, []);
  const slices = data.map((r, i) => {
    const frac = fracs[i];
    const a0 = starts[i], a1 = a0 + frac * 2 * Math.PI;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    const p = (rad: number, a: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const mid = (a0 + a1) / 2;
    return {
      r, frac,
      path: `M${p(rOuter, a0)} A${rOuter},${rOuter} 0 ${large} 1 ${p(rOuter, a1)} L${p(rInner, a1)} A${rInner},${rInner} 0 ${large} 0 ${p(rInner, a0)} Z`,
      labelAt: { x: cx + (rOuter + 16) * Math.cos(mid), y: cy + (rOuter + 16) * Math.sin(mid) },
    };
  });

  return (
    <div className="flex flex-wrap items-center gap-4">
      <BrokerPaletteStyle />
      <svg viewBox={`0 0 ${size} ${size}`} className="w-[240px] shrink-0" role="img" aria-label="Broker-wise catalogue quantity">
        {data.length === 1 && (
          /* A full 360-degree arc collapses to nothing in SVG - draw the lone broker as a ring. */
          <circle cx={cx} cy={cy} r={(rOuter + rInner) / 2} fill="none"
            stroke={brokerColorVar(data[0].key)} strokeWidth={rOuter - rInner}>
            <title>{`${brokerCode(data[0].key)}: ${mkg(data[0].totalQtyKg)} kg (100%)`}</title>
          </circle>
        )}
        {data.length > 1 && slices.map(({ r, frac, path }) => (
          <path key={r.key} d={path} fill={brokerColorVar(r.key)} stroke="var(--paper-0)" strokeWidth="2">
            <title>{`${brokerCode(r.key)}${brokerName(r.key) ? ` — ${brokerName(r.key)}` : ""}: ${mkg(r.totalQtyKg)} kg (${(frac * 100).toFixed(1)}%) · ${nf.format(r.lots)} lots`}</title>
          </path>
        ))}
        {data.length > 1 && slices.filter((s) => s.frac >= 0.06).map(({ r, frac, labelAt }) => (
          <text key={r.key} x={labelAt.x} y={labelAt.y} textAnchor="middle" dominantBaseline="middle"
            fontSize="10" className="fill-[var(--ink-700)]">
            {brokerCode(r.key)} {(frac * 100).toFixed(0)}%
          </text>
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="17" fontWeight="600" className="fill-[var(--ink-900)]">
          {mkg(total)}
        </text>
        <text x={cx} y={cy + 12} textAnchor="middle" fontSize="10" className="fill-[var(--ink-muted)]">
          kg catalogued
        </text>
      </svg>
      <ul className="m-0 p-0 list-none flex flex-col gap-1 min-w-[190px] flex-1">
        {data.map((r) => (
          <li key={r.key} className="flex items-center gap-2 text-[12px]">
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: brokerColorVar(r.key) }} />
            <span className="text-text-strong font-medium">{brokerCode(r.key)}</span>
            <span className="text-text-muted truncate flex-1">{brokerName(r.key) ?? r.label ?? ""}</span>
            <span className="tabular-nums text-text">{mkg(r.totalQtyKg)}</span>
            <span className="tabular-nums text-text-muted w-[46px] text-right">{((r.totalQtyKg / total) * 100).toFixed(1)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function BrokerAvgBars({ rows, totalAvg }: { rows: FilteredSectionRow[]; totalAvg: number | null }) {
  const data = useMemo(
    () => rows.filter((r) => r.avgPriceRs != null).sort((a, b) => b.avgPriceRs! - a.avgPriceRs!),
    [rows]
  );
  if (data.length === 0) return <p className="text-[12px] text-text-muted m-0">No sold lots in this slice.</p>;

  const w = 560, h = 190, px = 34, pyTop = 30, pyBot = 26;
  const max = Math.max(...data.map((d) => d.avgPriceRs!), totalAvg ?? 0) * 1.08;
  const bw = Math.min(44, (w - 2 * px) / data.length - 10);
  const x = (i: number) => px + ((i + 0.5) * (w - 2 * px)) / data.length;
  const y = (v: number) => h - pyBot - (v / max) * (h - pyTop - pyBot);

  return (
    <div className="overflow-x-auto">
      <BrokerPaletteStyle />
      {totalAvg != null && (
        <p className="text-[12.5px] m-0 mb-1 text-text-strong font-semibold">
          Total AVG: <span className="tabular-nums">Rs {nf2.format(totalAvg)}</span>
        </p>
      )}
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[420px]" role="img" aria-label="Broker-wise weighted average price">
        <line x1={px - 6} y1={h - pyBot} x2={w - px + 6} y2={h - pyBot} stroke="var(--line)" strokeWidth="1" />
        {totalAvg != null && (
          <g>
            <line x1={px - 6} y1={y(totalAvg)} x2={w - px + 6} y2={y(totalAvg)}
              stroke="var(--ink-muted)" strokeWidth="1" strokeDasharray="4 3" />
            <text x={w - px + 4} y={y(totalAvg) - 4} textAnchor="end" fontSize="9" className="fill-[var(--ink-muted)]">
              avg
            </text>
          </g>
        )}
        {data.map((r, i) => (
          <Tooltip key={r.key} title={`${brokerCode(r.key)}${brokerName(r.key) ? ` — ${brokerName(r.key)}` : ""}: Rs ${nf2.format(r.avgPriceRs!)} · ${nf.format(r.soldLots)} sold lots`} placement="top" arrow>
            <g>
              <rect x={x(i) - bw / 2} y={y(r.avgPriceRs!)} width={bw} height={h - pyBot - y(r.avgPriceRs!)}
                rx="4" fill={brokerColorVar(r.key)} stroke="var(--paper-0)" strokeWidth="1" />
              <text x={x(i)} y={y(r.avgPriceRs!) - 5} textAnchor="middle" fontSize="10" className="fill-[var(--ink-700)]">
                {nf.format(Math.round(r.avgPriceRs!))}
              </text>
              <text x={x(i)} y={h - pyBot + 13} textAnchor="middle" fontSize="10.5" className="fill-[var(--ink-700)]">
                {brokerCode(r.key)}
              </text>
            </g>
          </Tooltip>
        ))}
      </svg>
    </div>
  );
}
