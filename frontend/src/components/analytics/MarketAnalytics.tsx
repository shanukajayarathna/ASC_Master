"use client";

import BarChart from "@/components/analytics/BarChart";
import { BrokerAvgBars, BrokerDonut } from "@/components/analytics/BrokerCharts";
import TeaLoader from "@/components/shared/TeaLoader";
import type { FilteredAnalytics, FilteredSectionRow } from "@/types/api";

/* =====================================================================
   MARKET ANALYTICS — the cross-filtered replacement for the external
   Power BI portal. One POST returns every section for the current
   filter combination (server-cached), so applying any filter re-renders
   the whole page from a single fast round trip.
   Pre Auction  = catalogue composition (quantity on offer).
   Post Auction = results (sold %, proceeds, weighted averages).
   ===================================================================== */

const nf = new Intl.NumberFormat("en-US");
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const kg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M kg` : `${nf.format(Math.round(v))} kg`);
const rs = (v: number | null) => (v == null ? "—" : `Rs ${nf2.format(v)}`);
const rsShort = (v: number) =>
  v >= 1_000_000_000 ? `Rs ${(v / 1_000_000_000).toFixed(2)}B` : `Rs ${(v / 1_000_000).toFixed(1)}M`;

function Kpi({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded-md bg-surface px-3.5 py-2.5 min-w-[128px] flex-1">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="font-display text-[18px] font-semibold text-text-strong leading-snug">{value}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
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

function StatTable({ rows, nameHeader, showResults }: { rows: FilteredSectionRow[]; nameHeader: string; showResults: boolean }) {
  return (
    <div className="overflow-x-auto max-h-[360px] overflow-y-auto border border-border rounded">
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 bg-surface">
          <tr className="text-left text-text-muted">
            <th className="px-2.5 py-1.5 font-medium border-b border-border">{nameHeader}</th>
            <th className="px-2.5 py-1.5 font-medium border-b border-border text-right">Lots</th>
            <th className="px-2.5 py-1.5 font-medium border-b border-border text-right">Qty (kg)</th>
            {showResults && <th className="px-2.5 py-1.5 font-medium border-b border-border text-right">Sold %</th>}
            {showResults && <th className="px-2.5 py-1.5 font-medium border-b border-border text-right">Avg (Rs)</th>}
            {showResults && <th className="px-2.5 py-1.5 font-medium border-b border-border text-right">Best (Rs)</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.key} className="border-b border-border/60 hover:bg-surface-sunken/40">
              <td className="px-2.5 py-1.5 whitespace-nowrap">
                <span className="text-text-strong">{r.key}</span>
                {r.label && r.label !== r.key && <span className="text-text-muted"> · {r.label}</span>}
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(r.lots)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(Math.round(r.totalQtyKg))}</td>
              {showResults && (
                <td className="px-2.5 py-1.5 text-right tabular-nums">{r.lots > 0 ? `${((r.soldLots / r.lots) * 100).toFixed(0)}%` : "—"}</td>
              )}
              {showResults && <td className="px-2.5 py-1.5 text-right tabular-nums">{r.avgPriceRs != null ? nf2.format(r.avgPriceRs) : "—"}</td>}
              {showResults && <td className="px-2.5 py-1.5 text-right tabular-nums">{r.maxPriceRs != null ? nf.format(r.maxPriceRs) : "—"}</td>}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={showResults ? 6 : 3} className="px-3 py-5 text-center text-text-muted">Nothing in this slice.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export default function MarketAnalytics({
  data, loading, error, mode,
}: {
  data: FilteredAnalytics | null;
  loading: boolean;
  error: string | null;
  mode: "pre" | "post";
}) {
  if (error) return <div className="p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>;
  if (!data)
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24" role="status" aria-live="polite">
        <TeaLoader size={72} />
        <p className="text-[13px] text-text-muted m-0">Brewing your analysis…</p>
      </div>
    );

  const t = data.total;
  const soldPct = t.lots > 0 ? (t.soldLots / t.lots) * 100 : 0;
  const post = mode === "post";
  const bar = (r: FilteredSectionRow, byAvg = false) => ({
    label: r.label && r.label !== r.key ? `${r.key} — ${r.label}` : r.key,
    value: byAvg ? (r.avgPriceRs ?? 0) : r.totalQtyKg,
    displayValue: byAvg ? rs(r.avgPriceRs) : kg(r.totalQtyKg),
    detail: `${r.key}: ${nf.format(r.lots)} lots, ${kg(r.totalQtyKg)}${r.avgPriceRs != null ? `, avg ${rs(r.avgPriceRs)}` : ""}, ${
      r.lots > 0 ? ((r.soldLots / r.lots) * 100).toFixed(0) : 0
    }% sold`,
  });

  return (
    <div className="flex flex-col gap-4 relative">
      {/* Updating overlay: the brewing cup floats over the previous (dimmed) numbers while
          the new slice loads — the brand's "working" mark, never a frozen-looking page. */}
      {loading && (
        <div
          className="absolute inset-0 z-10 flex flex-col items-center pt-28 gap-3 rounded-md"
          role="status"
          aria-live="polite"
          style={{ background: "color-mix(in srgb, var(--paper-0) 55%, transparent)" }}
        >
          <div className="sticky top-32 flex flex-col items-center gap-3">
            <TeaLoader size={64} />
            <span className="text-[12.5px] font-medium text-text">Updating for your filters…</span>
          </div>
        </div>
      )}
      <div className={`flex flex-col gap-4 transition-opacity duration-200 ${loading ? "opacity-60" : "opacity-100"}`}>
      <div className="flex flex-wrap gap-2">
        <Kpi label="Lots" value={nf.format(t.lots)} hint={post ? `${nf.format(t.soldLots)} sold (${soldPct.toFixed(1)}%)` : undefined} />
        <Kpi label={post ? "Sold quantity" : "Catalogue quantity"} value={post ? kg(t.soldQtyKg) : kg(t.totalQtyKg)} hint={post ? `of ${kg(t.totalQtyKg)}` : undefined} />
        {post && <Kpi label="Proceeds" value={rsShort(t.proceedsRs)} hint="sold value" />}
        {post && <Kpi label="Weighted avg" value={rs(t.avgPriceRs)} hint="per kg, sold lots" />}
        {post && <Kpi label="Best price" value={t.maxPriceRs != null ? `Rs ${nf.format(t.maxPriceRs)}` : "—"} />}
        {!post && <Kpi label="Marks" value={nf.format(data.byMark.length) + (data.byMark.length >= 120 ? "+" : "")} />}
        {!post && <Kpi label="Grades" value={String(data.byGrade.length)} />}
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
          <BarChart rows={data.byElevation.filter((r) => r.label).map((r) => ({ ...bar(r, post), label: r.label! }))} />
        </Card>
        <Card title={post ? "Category averages" : "Category mix"} subtitle="standard grade categories">
          <BarChart rows={data.byCategory.slice(0, 10).map((r) => bar(r, post))} />
        </Card>
        {post ? (
          <Card title="Price ranges" subtitle="sold quantity per Rs/kg band">
            <BarChart
              rows={data.byPriceRange
                .filter((r) => r.key !== "Unsold")
                .map((r) => ({ label: r.key, value: r.soldQtyKg, displayValue: kg(r.soldQtyKg), detail: `${r.key}: ${nf.format(r.soldLots)} lots` }))}
            />
            {(() => {
              const unsold = data.byPriceRange.find((r) => r.key === "Unsold");
              return unsold ? (
                <p className="text-[11.5px] text-text-muted mt-2 mb-0">Unsold: {nf.format(unsold.lots)} lots, {kg(unsold.totalQtyKg)}.</p>
              ) : null;
            })()}
          </Card>
        ) : (
          <Card title="Top selling marks" subtitle="catalogue quantity">
            <BarChart rows={data.byMark.slice(0, 12).map((r) => bar(r))} />
          </Card>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Grade mix" subtitle={post ? "sold qty, share and averages" : "catalogue grade list"}>
          <StatTable rows={data.byGrade} nameHeader="Grade" showResults={post} />
        </Card>
        {post ? (
          <Card title="Top buyers" subtitle="by purchased quantity">
            <StatTable
              rows={data.byBuyer.slice(0, 40).map((r) => ({ ...r, key: r.label ?? r.key, label: null }))}
              nameHeader="Buyer"
              showResults
            />
          </Card>
        ) : (
          <Card title="Marks — catalogue" subtitle="top 120 by quantity">
            <StatTable rows={data.byMark} nameHeader="Mark" showResults={false} />
          </Card>
        )}
        {post && (
          <Card title="Marks — results" subtitle="top 120 by quantity">
            <StatTable rows={data.byMark} nameHeader="Mark" showResults />
          </Card>
        )}
        {post && (
          <Card title="Factories" subtitle="top 120 by quantity">
            <StatTable rows={data.byFactory} nameHeader="Factory" showResults />
          </Card>
        )}
      </div>

      <p className="text-[11px] text-text-muted m-0">
        {nf.format(t.lots)} lots in slice · server {data.elapsedMs} ms · updates automatically with new MSL files
      </p>
      </div>
    </div>
  );
}
