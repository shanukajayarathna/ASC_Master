"use client";

import BarChart from "@/components/analytics/BarChart";
import { BrokerAvgBars, BrokerDonut } from "@/components/analytics/BrokerCharts";
import { SkeletonCard } from "@/components/shared/SkeletonBlock";
import type { FilteredAnalytics, FilteredSectionRow, MslFilterOptions } from "@/types/api";
import { useMemo } from "react";

/* =====================================================================
   MARKET ANALYTICS — tile-first: every essential figure as a rectangular
   tile (the portal's headline cards), the two broker charts, the trend,
   and ONE table (Grade Mix, grouped Main/Off like the portal report).
   Buyers/Marks/Factories/Invoice-line tables live in the generated
   reports below, not on the page.
   ===================================================================== */

const nf = new Intl.NumberFormat("en-US");
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M kg` : `${nf.format(Math.round(v))} kg`);
const rs = (v: number | null | undefined) => (v == null ? "—" : `Rs ${nf2.format(v)}`);
const rsShort = (v: number) =>
  v >= 1_000_000_000 ? `Rs ${(v / 1_000_000_000).toFixed(2)}B` : `Rs ${(v / 1_000_000).toFixed(1)}M`;

function Tile({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: string }) {
  return (
    <div className="border border-border rounded-md bg-surface min-w-[136px] flex-1 overflow-hidden">
      <div className="px-3 py-1 text-[10.5px] font-semibold uppercase tracking-wide text-white truncate"
        style={{ background: accent ?? "#1F3C6E" }}>
        {label}
      </div>
      <div className="px-3 py-1.5">
        <div className="font-display text-[16.5px] font-semibold text-text-strong leading-snug truncate">{value}</div>
        {hint && <div className="text-[10.5px] text-text-muted truncate">{hint}</div>}
      </div>
    </div>
  );
}

function Card({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="border border-border rounded-md bg-surface p-4">
      <div className="flex items-baseline gap-2 mb-3 flex-wrap">
        <h4 className="font-display text-[14px] font-semibold text-text-strong m-0">{title}</h4>
        {subtitle && <span className="text-[11.5px] text-text-muted">{subtitle}</span>}
      </div>
      {children}
    </section>
  );
}

function TrendLine({ data }: { data: { label: string; value: number }[] }) {
  if (data.length < 2) return <p className="text-[12px] text-text-muted m-0">Not enough sales in this slice for a trend.</p>;
  const w = 560, h = 120, px = 8, py = 12;
  const vals = data.map((d) => d.value);
  const min = Math.min(...vals), max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => px + (i * (w - 2 * px)) / (data.length - 1);
  const y = (v: number) => h - py - ((v - min) * (h - 2 * py)) / span;
  const path = data.map((d, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(d.value).toFixed(1)}`).join(" ");
  const last = data[data.length - 1];
  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full min-w-[420px]" role="img" aria-label="Weighted average price by sale">
        <line x1={px} y1={h - py} x2={w - px} y2={h - py} stroke="var(--line)" strokeWidth="1" />
        <path d={path} fill="none" stroke="var(--brand-gold)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {data.map((d, i) => (
          <circle key={d.label} cx={x(i)} cy={y(d.value)} r={i === data.length - 1 ? 4 : 3} fill="var(--brand-gold)" stroke="var(--paper-0)" strokeWidth="2">
            <title>{`${d.label}: Rs ${nf2.format(d.value)}`}</title>
          </circle>
        ))}
        <text x={x(data.length - 1) - 4} y={y(last.value) - 8} textAnchor="end" className="fill-[var(--ink-700)]" fontSize="11">
          Rs {nf.format(Math.round(last.value))}
        </text>
        <text x={px} y={h - 1} fontSize="10" className="fill-[var(--ink-muted)]">{data[0].label}</text>
        <text x={w - px} y={h - 1} textAnchor="end" fontSize="10" className="fill-[var(--ink-muted)]">{last.label}</text>
      </svg>
    </div>
  );
}

export default function MarketAnalytics({
  data, error, mode, options,
}: {
  data: FilteredAnalytics | null;
  error: string | null;
  mode: "pre" | "post";
  options: MslFilterOptions | null;
}) {
  const gradeClasses = useMemo(() => options?.gradeClasses ?? {}, [options]);

  const tiles = useMemo(() => {
    if (!data) return [];
    const t = data.total;
    const soldLotPct = t.lots > 0 ? (t.soldLots / t.lots) * 100 : 0;
    const soldQtyPct = t.totalQtyKg > 0 ? (t.soldQtyKg / t.totalQtyKg) * 100 : 0;
    const cls = (idx: number, name: string) =>
      data.byGrade.filter((g) => (gradeClasses[g.key]?.[idx] ?? "") === name);
    const sum = (rows: FilteredSectionRow[], f: (r: FilteredSectionRow) => number) => rows.reduce((s, r) => s + f(r), 0);
    const avgOf = (rows: FilteredSectionRow[]) => {
      const sq = sum(rows, (r) => r.soldQtyKg);
      return sq > 0 ? sum(rows, (r) => r.proceedsRs) / sq : null;
    };
    const main = cls(1, "Main Grade"), off = cls(1, "Off Grade");
    const green = cls(2, "Green Tea"), ctc = cls(3, "CTC"), orthodox = cls(3, "Orthodox");
    const priv = data.available.saleTypes.find((s) => s.key === "private");
    const refuse = data.available.refuseTea.find((r) => r.key === "only");
    const topBuyer = data.byBuyer.filter((b) => b.key !== "(none)")[0];
    const topMark = data.byMark[0];
    const topGrade = data.byGrade[0];
    const post = mode === "post";

    const rows: { label: string; value: string; hint?: string; accent?: string }[] = [
      { label: "Total lots", value: nf.format(t.lots), hint: post ? `${nf.format(t.soldLots)} sold · ${soldLotPct.toFixed(1)}%` : undefined, accent: "#1F3C6E" },
      { label: post ? "Total sold qty" : "Catalogue qty", value: post ? kg(t.soldQtyKg) : kg(t.totalQtyKg), hint: post ? `of ${kg(t.totalQtyKg)} (${soldQtyPct.toFixed(1)}%)` : undefined, accent: "#1F3C6E" },
    ];
    if (post) rows.push(
      { label: "Total proceeds", value: rsShort(t.proceedsRs), hint: "sold value", accent: "#1F3C6E" },
      { label: "Total AVG", value: rs(t.avgPriceRs), hint: "qty-weighted, sold", accent: "#1F3C6E" },
      { label: "Best price", value: t.maxPriceRs != null ? `Rs ${nf.format(t.maxPriceRs)}` : "—", accent: "#1F3C6E" },
      { label: "Unsold", value: kg(t.totalQtyKg - t.soldQtyKg), hint: `${nf.format(t.lots - t.soldLots)} lots (${(100 - soldQtyPct).toFixed(1)}%)`, accent: "#A04000" },
    );
    rows.push(
      { label: "Main grade", value: kg(sum(main, (r) => (post ? r.soldQtyKg : r.totalQtyKg))), hint: post ? `avg ${rs(avgOf(main))}` : `${main.length} grades`, accent: "#5B3E8E" },
      { label: "Off grade", value: kg(sum(off, (r) => (post ? r.soldQtyKg : r.totalQtyKg))), hint: post ? `avg ${rs(avgOf(off))}` : `${off.length} grades`, accent: "#5B3E8E" },
      { label: "Green tea", value: kg(sum(green, (r) => (post ? r.soldQtyKg : r.totalQtyKg))), hint: post ? `avg ${rs(avgOf(green))}` : undefined, accent: "#1E6E45" },
      { label: "Orthodox / CTC", value: `${kg(sum(orthodox, (r) => (post ? r.soldQtyKg : r.totalQtyKg)))} / ${kg(sum(ctc, (r) => (post ? r.soldQtyKg : r.totalQtyKg)))}`, hint: post ? `avg ${rs(avgOf(orthodox))} / ${rs(avgOf(ctc))}` : undefined, accent: "#7A5C00" },
    );
    if (priv) rows.push({ label: "Private sale", value: nf.format(priv.lots) + " lots", accent: "#A04000" });
    if (refuse) rows.push({ label: "Refused tea", value: nf.format(refuse.lots) + " lots", accent: "#A04000" });
    if (post && topBuyer) rows.push({ label: "Top buyer", value: topBuyer.label ?? topBuyer.key, hint: kg(topBuyer.soldQtyKg), accent: "#8E3557" });
    if (topMark) rows.push({ label: "Top mark", value: topMark.key, hint: `${kg(topMark.totalQtyKg)}${topMark.avgPriceRs != null ? ` · avg ${rs(topMark.avgPriceRs)}` : ""}`, accent: "#1E6E45" });
    if (topGrade) rows.push({ label: "Top grade", value: topGrade.key, hint: `${kg(topGrade.totalQtyKg)}${post && topGrade.avgPriceRs != null ? ` · avg ${rs(topGrade.avgPriceRs)}` : ""}`, accent: "#5B3E8E" });
    return rows;
  }, [data, gradeClasses, mode]);

  if (error) return <div className="p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>;
  if (!data) return <SkeletonCard />;

  const t = data.total;
  const post = mode === "post";

  return (
    <div className="flex flex-col gap-4 relative">
      <div className="flex flex-col gap-4">

        {/* Essentials — every headline figure as a tile, colour-matched to its filter family. */}
        <div className="flex flex-wrap gap-2">
          {tiles.map((tile) => (
            <Tile key={tile.label} {...tile} />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Broker wise catalogue qty" subtitle="share of quantity — every filter applies">
            <BrokerDonut rows={data.byBroker} />
          </Card>
          <Card title="Broker wise average" subtitle="qty-weighted average of sold lots">
            <BrokerAvgBars rows={data.byBroker} totalAvg={t.avgPriceRs} />
          </Card>
        </div>

        {post && (
          <Card title="Average price by sale" subtitle="qty-weighted, across the filtered slice">
            <TrendLine data={data.bySale.filter((s) => s.avgPriceRs != null).map((s) => ({ label: s.key, value: s.avgPriceRs! }))} />
          </Card>
        )}

        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Elevation" subtitle={post ? "weighted avg by elevation" : "quantity by elevation"}>
            <BarChart
              rows={data.byElevation.filter((r) => r.label).map((r) => ({
                label: r.label!,
                value: post ? (r.avgPriceRs ?? 0) : r.totalQtyKg,
                displayValue: post ? rs(r.avgPriceRs) : kg(r.totalQtyKg),
                detail: `${r.label}: ${nf.format(r.lots)} lots, ${kg(r.totalQtyKg)}${r.avgPriceRs != null ? `, avg ${rs(r.avgPriceRs)}` : ""}`,
              }))}
            />
          </Card>
          <Card title={post ? "Category averages" : "Category mix"} subtitle="standard grade categories">
            <BarChart
              rows={data.byCategory.slice(0, 10).map((r) => ({
                label: r.key,
                value: post ? (r.avgPriceRs ?? 0) : r.totalQtyKg,
                displayValue: post ? rs(r.avgPriceRs) : kg(r.totalQtyKg),
                detail: `${r.key}: ${nf.format(r.lots)} lots, ${kg(r.totalQtyKg)}`,
              }))}
            />
          </Card>
        </div>

        <p className="text-[11px] text-text-muted m-0">
          {nf.format(t.lots)} lots in slice · server {data.elapsedMs} ms · buyers, marks, factories and invoice
          lines are inside the reports below · updates automatically with new MSL files
        </p>
      </div>
    </div>
  );
}
