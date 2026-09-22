"use client";

import type { GrademixCompareFactory } from "@/types/api";
import { DivergingBars, GroupedBarChart, Legend, StackedShare, pct, rs, rs2, signed } from "./charts";

const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)"];
const GROUP_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-7)"];

function shortName(n: string) {
  const s = n.replace(/\s*(TEA\s+)?(FACTORY|PROCESSING CENTER|ESTATE)\b.*$/i, "").trim() || n;
  return s.length > 16 ? `${s.slice(0, 15)}…` : s;
}

/** Factories the user picked, side by side, in the same visual language as the single-factory
 *  sheet. With hidePeers on, every factory except the first (the one being presented) is
 *  anonymised — for showing an owner how they sit against the field without naming rivals. */
export default function CompareView({ items, hidePeers }: { items: GrademixCompareFactory[]; hidePeers: boolean }) {
  if (items.length === 0) return null;
  const name = (i: number) => (hidePeers && i > 0 ? `Peer ${String.fromCharCode(64 + i)}` : items[i].factory.name);
  const short = (i: number) => (hidePeers && i > 0 ? `Peer ${String.fromCharCode(64 + i)}` : shortName(items[i].factory.name));
  const months = items[0].monthly;
  const groupNames = items[0].groups.map((g) => g.name);
  const mixedElevations = new Set(items.map((i) => i.factory.elevation ?? "")).size > 1;

  const card = "border border-border rounded-[var(--radius-md)] p-4";
  const cardStyle = { background: "var(--surface)" };

  return (
    <div className="report-print-area">
      <h2 className="font-display text-[20px] font-semibold text-text-strong m-0 mb-3">Factory comparison</h2>

      <div className={`${card} mb-5 overflow-x-auto`} style={cardStyle}>
        <table className="w-full border-collapse text-[12.5px]">
          <thead>
            <tr style={{ background: "var(--surface-alt)" }}>
              {["Factory", "Elevation", "Sold kg", "Avg Rs", "National avg", "Above / below", "Expected next sale"].map((h) => (
                <th key={h} className="px-2 py-1 border border-border text-right first:text-left text-[10.5px] uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {items.map((it, i) => {
              const diff = it.avgRs != null ? it.avgRs - it.nationalAvgRs : null;
              return (
                <tr key={it.factory.code}>
                  <td className="px-2 py-[3px] border border-border font-medium">
                    <span className="inline-block w-2.5 h-2.5 rounded-[2px] mr-1.5 align-middle" style={{ background: SERIES[i] }} />
                    {name(i)}
                  </td>
                  <td className="px-2 py-[3px] border border-border text-right">{it.factory.elevationLabel ?? "–"}</td>
                  <td className="px-2 py-[3px] border border-border text-right font-mono">{rs(it.soldKg)}</td>
                  <td className="px-2 py-[3px] border border-border text-right font-mono">{rs2(it.avgRs)}</td>
                  <td className="px-2 py-[3px] border border-border text-right font-mono">{rs2(it.nationalAvgRs)}</td>
                  <td className={`px-2 py-[3px] border border-border text-right font-mono ${diff != null && diff < 0 ? "text-danger" : ""}`}>{diff == null ? "–" : signed(diff)}</td>
                  <td className="px-2 py-[3px] border border-border text-right font-mono">{rs2(it.expectedAvgRs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {mixedElevations && (
          <p className="m-0 mt-1.5 text-[11.5px] text-text-muted">
            These factories sit in different elevations, so each is measured against its own elevation's Tea Board average.
          </p>
        )}
      </div>

      <div className="grid lg:grid-cols-2 gap-6 mb-5">
        <div className={card} style={cardStyle}>
          <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">Last sale — average price</h3>
          <p className="m-0 mb-2 text-[12px] text-text-muted">Each factory against the national average for its own elevation.</p>
          <Legend items={[{ name: "Factory average", color: "var(--series-1)" }, { name: "National average", color: "var(--series-4)" }]} />
          <GroupedBarChart
            ariaLabel="Average price per factory against its national elevation average"
            height={240}
            labels={items.map((_, i) => short(i))}
            series={[
              { name: "Factory", color: "var(--series-1)", values: items.map((i) => i.avgRs) },
              { name: "National", color: "var(--series-4)", values: items.map((i) => i.nationalAvgRs) },
            ]}
          />
        </div>
        <div className={card} style={cardStyle}>
          <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">How the volume was made up</h3>
          <p className="m-0 mb-3 text-[12px] text-text-muted">Share of kg sold by grade group.</p>
          <StackedShare
            groups={groupNames.map((n, i) => ({ name: n, color: GROUP_COLORS[i] }))}
            rows={items.map((it, i) => ({ label: name(i), parts: it.groups.map((g) => g.qtyPct) }))}
          />
        </div>
      </div>

      <div className={`${card} mb-5`} style={cardStyle}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">Month by month</h3>
        <p className="m-0 mb-2 text-[12px] text-text-muted">Average price achieved per calendar month.</p>
        <Legend items={items.map((_, i) => ({ name: name(i), color: SERIES[i] }))} />
        <GroupedBarChart
          ariaLabel="Monthly average price per factory"
          labels={months.map((m) => (m.inProgress ? `${m.label}*` : m.label))}
          series={items.map((it, i) => ({ name: name(i), color: SERIES[i], values: it.monthly.map((m) => m.avgRs) }))}
        />
        <p className="m-0 mt-1 text-[11px] text-text-muted">* month to date</p>
      </div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-4">
        {items.map((it, i) => (
          <div key={it.factory.code} className={card} style={cardStyle}>
            <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-0.5">
              <span className="inline-block w-2.5 h-2.5 rounded-[2px] mr-1.5" style={{ background: SERIES[i] }} />
              {name(i)}
            </h3>
            <p className="m-0 mb-3 text-[12px] text-text-muted">
              Contribution to average, Rs/kg vs national ({pct(it.groups.reduce((s, g) => s + g.qtyPct, 0), 0)} of volume grouped)
            </p>
            <DivergingBars rows={it.groups.map((g) => ({ label: g.name, value: g.contriValue }))} />
          </div>
        ))}
      </div>
    </div>
  );
}
