"use client";

import TeaLoader from "@/components/shared/TeaLoader";
import { api } from "@/lib/api";
import { brokerCode, brokerName, BROKERS } from "@/lib/brokers";
import type {
  FilteredAnalytics,
  FilteredLotRow,
  FilteredSectionRow,
  MslAnalyticsFilter,
} from "@/types/api";
import CloseIcon from "@mui/icons-material/Close";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import IconButton from "@mui/material/IconButton";
import { Fragment, useEffect, useState } from "react";
import DrillTable, { drill } from "./DrillTable";
import type { ReportDef } from "./ReportsLauncher";

/* =====================================================================
   REPORT DIALOG — generates the selected report from the CURRENT filter
   slice. Each report is print-ready (Print → browser's Save as PDF),
   titled and stamped like the portal's print formats.
   ===================================================================== */

const nf = new Intl.NumberFormat("en-US");
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function filterSummary(f: MslAnalyticsFilter): string {
  const parts: string[] = [];
  if (f.years?.length) parts.push(`Year ${f.years.join(", ")}`);
  if (f.saleNos?.length) parts.push(`Sale ${f.saleNos.join(", ")}`);
  if (f.months?.length) parts.push(`Months ${f.months.join(", ")}`);
  if (f.brokers?.length) parts.push(`Brokers ${f.brokers.map(brokerCode).join(", ")}`);
  if (f.elevations?.length) parts.push(f.elevations.join(", "));
  if (f.categories?.length) parts.push(f.categories.join(", "));
  if (f.grades?.length) parts.push(`${f.grades.length} grades`);
  if (f.saleType) parts.push(f.saleType === "public" ? "Public auction" : "Private sale");
  if (f.soldStatus) parts.push(f.soldStatus === "sold" ? "Sold only" : "Unsold only");
  return parts.length ? parts.join(" · ") : "Whole archive";
}

const PAGE_ROWS = 50;

/** Report table: renders 50 rows and loads 50 more each time the scroll nears the
 *  bottom - big slices never freeze the dialog. Print includes what's loaded. */
function Table({ headers, rows, rightFrom = 1 }: { headers: string[]; rows: (string | number)[][]; rightFrom?: number }) {
  const [visible, setVisible] = useState(PAGE_ROWS);
  const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && visible < rows.length) {
      setVisible((v) => v + PAGE_ROWS);
    }
  };
  return (
    <div className="overflow-auto border border-border rounded max-h-[480px] print:max-h-none" onScroll={onScroll}>
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 z-[1]">
          <tr className="text-left text-white" style={{ background: "#1F3C6E" }}>
            {headers.map((h, i) => (
              <th key={h} className={`px-2.5 py-1.5 font-medium whitespace-nowrap ${i >= rightFrom ? "text-right" : ""}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, visible).map((r, ri) => (
            <tr key={ri} className="border-b border-border/50">
              {r.map((c, ci) => (
                <td key={ci} className={`px-2.5 py-1 whitespace-nowrap ${ci >= rightFrom ? "text-right tabular-nums" : ""}`}>{c}</td>
              ))}
            </tr>
          ))}
          {rows.length === 0 && (
            <tr><td colSpan={headers.length} className="px-3 py-4 text-center text-text-muted">Nothing in this slice.</td></tr>
          )}
          {visible < rows.length && (
            <tr><td colSpan={headers.length} className="px-3 py-2 text-center text-[11px] text-text-muted">
              Showing {visible} of {rows.length} rows - scroll for more
            </td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** The portal's "Sold, Outsold & Unsold Status" pie - three blues, direct labels. */
function OkloPie({ rows }: { rows: FilteredSectionRow[] }) {
  const val = (k: string) => rows.find((r) => r.key === k)?.totalQtyKg ?? 0;
  const parts = [
    { key: "Sold", qty: val("Sold"), color: "#56B4E9" },
    { key: "Unsold", qty: val("Unsold"), color: "#0D3B8C" },
    { key: "Outsold", qty: val("Outsold"), color: "#1F6FD6" },
  ].filter((x) => x.qty > 0);
  const total = parts.reduce((s, x) => s + x.qty, 0);
  if (total === 0) return <p className="text-[12px] text-text-muted m-0">No OKLO status in this slice (pre-2026 data).</p>;
  const size = 150, cx = 75, cy = 75, r = 62;
  const starts = parts.reduce<number[]>((acc, x, i) => {
    acc.push(i === 0 ? -Math.PI / 2 : acc[i - 1] + (parts[i - 1].qty / total) * 2 * Math.PI);
    return acc;
  }, []);
  const mkg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : nf.format(Math.round(v)));
  return (
    <div className="flex items-center gap-3 flex-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-[130px] shrink-0">
        {parts.map((x, i) => {
          const a0 = starts[i], a1 = a0 + (x.qty / total) * 2 * Math.PI;
          const large = a1 - a0 > Math.PI ? 1 : 0;
          const pt = (a: number) => `${cx + r * Math.cos(a)},${cy + r * Math.sin(a)}`;
          return (
            <path key={x.key} d={`M${cx},${cy} L${pt(a0)} A${r},${r} 0 ${large} 1 ${pt(a1)} Z`}
              fill={x.color} stroke="var(--paper-0)" strokeWidth="2">
              <title>{`${x.key}: ${mkg(x.qty)} kg (${((x.qty / total) * 100).toFixed(1)}%)`}</title>
            </path>
          );
        })}
      </svg>
      <div className="text-[12px] flex flex-col gap-0.5">
        {parts.map((x) => (
          <div key={x.key}>
            <span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: x.color }} />
            {x.key} {mkg(x.qty)} ({((x.qty / total) * 100).toFixed(1)}%)
          </div>
        ))}
      </div>
    </div>
  );
}

/** Grade × Broker matrix (the portal's Broker Wise Grade Mix): rows are grade types →
 *  grades (→ packings on expand), columns are brokers with Qty | % | Avg each plus a
 *  Total. Packing children load lazily per broker from the cached endpoint. */
function BrokerMatrix({ base, slices, gradeClasses, baseFilter, mode }: {
  base: FilteredAnalytics;
  slices: { label: string; broker: string; data: FilteredAnalytics }[];
  gradeClasses: Record<string, string[]>;
  baseFilter: MslAnalyticsFilter;
  mode: "sold" | "unsold";
}) {
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [packRows, setPackRows] = useState<Record<string, Record<string, Record<string, FilteredSectionRow>>>>({});
  const qty = (r: FilteredSectionRow | undefined) => (r == null ? 0 : mode === "sold" ? r.soldQtyKg : r.totalQtyKg - r.soldQtyKg);
  const grandTotal = slices.reduce((s, b) => s + qty(b.data.total), 0) || 1;

  const gradeBy = (broker: string) => {
    const s = slices.find((x) => x.broker === broker);
    return new Map((s?.data.byGrade ?? []).map((g) => [g.key, g]));
  };
  const brokerGradeMaps = new Map(slices.map((s) => [s.broker, gradeBy(s.broker)]));

  const types = gradeTypeRows(base, gradeClasses);
  const gradesOf = (t: string) =>
    base.byGrade
      .filter((g) => (gradeClasses[g.key]?.[1] ?? "Main Grade") === t && qty(g) > 0)
      .sort((a, b) => qty(b) - qty(a));

  const toggleGrade = async (grade: string) => {
    const key = `g/${grade}`;
    if (open[key]) { setOpen((o) => ({ ...o, [key]: false })); return; }
    setOpen((o) => ({ ...o, [key]: true }));
    if (!packRows[grade]) {
      const results = await Promise.all(slices.map(async (s) => {
        const d = await api.mslFilteredAnalytics({ ...baseFilter, brokers: [s.broker], grades: [grade] });
        return [s.broker, d.byPacking] as const;
      }));
      const perPack: Record<string, Record<string, FilteredSectionRow>> = {};
      for (const [broker, rows] of results)
        for (const r of rows) {
          if (qty(r) <= 0) continue;
          (perPack[r.key] ??= {})[broker] = r;
        }
      setPackRows((pr) => ({ ...pr, [grade]: perPack }));
    }
  };

  const cell = (r: FilteredSectionRow | undefined) => (
    <>
      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{r ? nf.format(Math.round(qty(r))) : ""}</td>
      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-text-muted">{r ? `${((qty(r) / grandTotal) * 100).toFixed(2)}%` : ""}</td>
      <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap border-r border-border/60">{mode === "sold" && r?.avgPriceRs != null ? nf2.format(r.avgPriceRs) : ""}</td>
    </>
  );

  const rowFor = (label: React.ReactNode, per: (broker: string) => FilteredSectionRow | undefined, cls: string, indent: number, totalRow?: FilteredSectionRow) => {
    const totQ = totalRow ? qty(totalRow) : slices.reduce((s, b) => s + qty(per(b.broker)), 0);
    return (
      <tr className={cls}>
        <td className="px-2.5 py-1 whitespace-nowrap sticky left-0 bg-paper-0" style={{ paddingLeft: `${10 + indent * 16}px` }}>{label}</td>
        {slices.map((s) => <Fragment key={s.broker}>{cell(per(s.broker))}</Fragment>)}
        <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap font-medium">{nf.format(Math.round(totQ))}</td>
        <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-text-muted">{((totQ / grandTotal) * 100).toFixed(2)}%</td>
      </tr>
    );
  };

  return (
    <div className="overflow-auto border border-border rounded max-h-[520px] print:max-h-none">
      <table className="text-[11.5px] border-collapse min-w-full">
        <thead className="sticky top-0 z-[2]">
          <tr className="text-white" style={{ background: "#1F3C6E" }}>
            <th className="px-2.5 py-1.5 font-medium text-left sticky left-0" style={{ background: "#1F3C6E" }}>Grade</th>
            {slices.map((s) => (
              <th key={s.broker} colSpan={3} className="px-2 py-1.5 font-medium text-center border-l border-white/20">{brokerCode(s.broker)}</th>
            ))}
            <th colSpan={2} className="px-2 py-1.5 font-medium text-center border-l border-white/20">Total</th>
          </tr>
          <tr className="text-white/85" style={{ background: "#2A4A80" }}>
            <th className="px-2.5 py-1 sticky left-0" style={{ background: "#2A4A80" }}></th>
            {slices.map((s) => (
              <Fragment key={s.broker}>
                <th className="px-2 py-1 font-normal text-right">Qty</th>
                <th className="px-2 py-1 font-normal text-right">%</th>
                <th className="px-2 py-1 font-normal text-right border-r border-white/10">Avg</th>
              </Fragment>
            ))}
            <th className="px-2 py-1 font-normal text-right">Qty</th>
            <th className="px-2 py-1 font-normal text-right">%</th>
          </tr>
        </thead>
        <tbody>
          {types.filter((t) => qty(t) > 0).map((t) => (
            <Fragment key={t.key}>
              {rowFor(
                <button onClick={() => setOpen((o) => ({ ...o, [`t/${t.key}`]: !(o[`t/${t.key}`] ?? true) }))} className="inline-flex items-center gap-1 font-semibold">
                  <span className="inline-block w-4 text-brass font-bold">{(open[`t/${t.key}`] ?? true) ? "−" : "+"}</span>{t.key}
                </button>, (b) => {
                const rows = brokerGradeMaps.get(b);
                if (!rows) return undefined;
                let lots = 0, soldLots = 0, q = 0, sq = 0, v = 0;
                for (const [gk, g] of rows) {
                  if ((gradeClasses[gk]?.[1] ?? "Main Grade") !== t.key) continue;
                  lots += g.lots; soldLots += g.soldLots; q += g.totalQtyKg; sq += g.soldQtyKg; v += g.proceedsRs;
                }
                if (lots === 0) return undefined;
                return { key: t.key, label: null, lots, soldLots, totalQtyKg: q, soldQtyKg: sq, proceedsRs: v,
                  avgPriceRs: sq > 0 ? v / sq : null, maxPriceRs: null, askingAvgRs: null };
              }, "bg-surface-sunken/70 font-semibold text-text-strong", 0, t)}
              {(open[`t/${t.key}`] ?? true) && gradesOf(t.key).map((g) => (
                <Fragment key={g.key}>
                  {rowFor(
                    <button onClick={() => toggleGrade(g.key)} className="inline-flex items-center gap-1">
                      <span className="inline-block w-4 text-brass font-bold">{open[`g/${g.key}`] ? "−" : "+"}</span>{g.key}
                    </button>,
                    (b) => brokerGradeMaps.get(b)?.get(g.key), "border-b border-border/40 hover:bg-surface-sunken/30 bg-surface", 1, g)}
                  {open[`g/${g.key}`] && packRows[g.key] && Object.entries(packRows[g.key])
                    .sort((a, b) => Number(a[0]) - Number(b[0]))
                    .map(([pack, per]) =>
                      rowFor(
                        <span className="text-text-muted">{pack === "(none)" ? "(no packing data)" : `${pack} kg`}</span>,
                        (b) => per[b], "border-b border-border/30 bg-surface", 2))}
                  {open[`g/${g.key}`] && !packRows[g.key] && (
                    <tr><td className="px-2.5 py-1 text-[11px] text-text-muted" style={{ paddingLeft: "42px" }} colSpan={slices.length * 3 + 3}>Loading packings…</td></tr>
                  )}
                </Fragment>
              ))}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Aggregate byGrade into Main/Off grade-type rows (client-side, no extra query). */
function gradeTypeRows(d: FilteredAnalytics, gradeClasses: Record<string, string[]>): FilteredSectionRow[] {
  const acc = new Map<string, { lots: number; soldLots: number; qty: number; soldQty: number; value: number; max: number | null }>();
  for (const g of d.byGrade) {
    const t = gradeClasses[g.key]?.[1] ?? "Main Grade";
    const cur = acc.get(t) ?? { lots: 0, soldLots: 0, qty: 0, soldQty: 0, value: 0, max: null };
    cur.lots += g.lots; cur.soldLots += g.soldLots; cur.qty += g.totalQtyKg;
    cur.soldQty += g.soldQtyKg; cur.value += g.proceedsRs;
    if (g.maxPriceRs != null) cur.max = Math.max(cur.max ?? 0, g.maxPriceRs);
    acc.set(t, cur);
  }
  return [...acc.entries()]
    .map(([key, v]) => ({
      key, label: null, lots: v.lots, soldLots: v.soldLots, totalQtyKg: v.qty, soldQtyKg: v.soldQty,
      proceedsRs: v.value, avgPriceRs: v.soldQty > 0 ? v.value / v.soldQty : null,
      maxPriceRs: v.max, askingAvgRs: null,
    }))
    .sort((a, b) => b.soldQtyKg - a.soldQtyKg);
}

function SoldPie({ sold, unsold }: { sold: number; unsold: number }) {
  const total = sold + unsold || 1;
  const frac = sold / total;
  const size = 150, cx = 75, cy = 75, r = 62;
  const a = -Math.PI / 2 + frac * 2 * Math.PI;
  const large = frac > 0.5 ? 1 : 0;
  return (
    <div className="flex items-center gap-3">
      <svg viewBox={`0 0 ${size} ${size}`} className="w-[130px]">
        <circle cx={cx} cy={cy} r={r} fill="var(--paper-200)" />
        <path
          d={`M${cx},${cy} L${cx},${cy - r} A${r},${r} 0 ${large} 1 ${cx + r * Math.cos(a)},${cy + r * Math.sin(a)} Z`}
          fill="#1E6E45" stroke="var(--paper-0)" strokeWidth="2"
        />
      </svg>
      <div className="text-[12px]">
        <div><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5" style={{ background: "#1E6E45" }} />Sold {nf.format(Math.round(sold))} kg ({(frac * 100).toFixed(2)}%)</div>
        <div><span className="inline-block w-2.5 h-2.5 rounded-full mr-1.5 bg-[var(--paper-200)]" />Unsold {nf.format(Math.round(unsold))} kg</div>
      </div>
    </div>
  );
}

/** Grade rows grouped Main/Off with sold + unsold views — the Factory Grade Mix core.
 *  Every row expands Power BI-style: Grade type → Grade → Packing → Buyer. */
function GradeMixReport({ data, gradeClasses, baseFilter }: { data: FilteredAnalytics; gradeClasses: Record<string, string[]>; baseFilter: MslAnalyticsFilter }) {
  return (
    <div className="flex flex-col gap-4">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-border rounded-md bg-surface p-3">
          <h4 className="text-[13px] font-semibold mt-0 mb-2">Sold &amp; Unsold</h4>
          <SoldPie sold={data.total.soldQtyKg} unsold={data.total.totalQtyKg - data.total.soldQtyKg} />
          <p className="text-[12px] text-text-muted mt-2 mb-0">
            Total Qty {nf.format(Math.round(data.total.totalQtyKg))} kg · Avg {data.total.avgPriceRs != null ? nf2.format(data.total.avgPriceRs) : "—"}
          </p>
        </div>
        <div className="border border-border rounded-md bg-surface p-3">
          <h4 className="text-[13px] font-semibold mt-0 mb-2">Sold, Outsold &amp; Unsold Status</h4>
          <OkloPie rows={data.byOkloStatus} />
        </div>
      </div>
      <div className="grid gap-4 xl:grid-cols-2 items-start">
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold mt-0 mb-1.5">Grade Mix — Sold Qty &amp; Average <span className="font-normal text-text-muted">| expand grade → packing → buyer</span></h4>
          <DrillTable
            baseFilter={baseFilter}
            rootRows={gradeTypeRows(data, gradeClasses)}
            levels={[
              { ...drill.gradeType(), childrenOf: (t) => data.byGrade.filter((g) => (gradeClasses[g.key]?.[1] ?? "Main Grade") === t.key) },
              drill.grade(), drill.packing(), drill.buyer(),
            ]}
            mode="sold"
            nameHeader="Grade type"
            openByDefault
          />
        </div>
        <div className="min-w-0">
          <h4 className="text-[13px] font-semibold mt-0 mb-1.5">Grade Mix (Unsold) <span className="font-normal text-text-muted">| expand grade → packing</span></h4>
          <DrillTable
            baseFilter={baseFilter}
            rootRows={gradeTypeRows(data, gradeClasses)}
            levels={[
              { ...drill.gradeType(), childrenOf: (t) => data.byGrade.filter((g) => (gradeClasses[g.key]?.[1] ?? "Main Grade") === t.key) },
              drill.grade(), drill.packing(),
            ]}
            mode="unsold"
            nameHeader="Grade type"
            openByDefault
          />
        </div>
      </div>
    </div>
  );
}

function LotLinesTable({ rows }: { rows: FilteredLotRow[] }) {
  return (
    <Table
      rightFrom={9}
      headers={["Year", "Sale date", "Sale", "Category", "Broker", "Factory", "Mark", "Inv", "Grade", "Lot", "Qty", "Price", "Status", "Buyer"]}
      rows={rows.map((r) => [
        r.saleYear,
        r.saleDate.slice(0, 10),
        r.saleNo,
        r.isPrivate ? "**PRIVATE SALE**" : r.category,
        brokerCode(r.broker),
        r.factoryCode,
        r.sellingMark,
        r.invoice ?? "",
        r.grade,
        r.lotNo,
        nf.format(Math.round(r.quantityKg)),
        r.priceRs > 0 ? nf.format(r.priceRs) : "",
        r.sold ? "SOLD" : "UNSOLD",
        r.buyer ?? "",
      ])}
    />
  );
}

export default function ReportDialog({
  report, filter, onClose,
}: {
  report: ReportDef;
  filter: MslAnalyticsFilter;
  onClose: () => void;
}) {
  const [data, setData] = useState<FilteredAnalytics | null>(null);
  const [gradeClasses, setGradeClasses] = useState<Record<string, string[]>>({});
  const [lots, setLots] = useState<FilteredLotRow[]>([]);
  const [lotsPage, setLotsPage] = useState(1);
  const [hasMoreLots, setHasMoreLots] = useState(false);
  const [lotSearch, setLotSearch] = useState("");
  const [subSlices, setSubSlices] = useState<{ label: string; broker: string; data: FilteredAnalytics }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const needsLots = report.id === "invoice-lines" || report.id === "factory-grade-mix";
  const perBroker = report.id === "broker-grade-mix";
  const perMonth = report.id === "month-grade-mix" || report.id === "quarter-grade-mix";

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [payload, options] = await Promise.all([api.mslFilteredAnalytics(filter), api.mslFilterOptions()]);
        if (cancelled) return;
        setData(payload);
        setGradeClasses(options.gradeClasses);
        if (needsLots) {
          const first = await api.mslFilteredLots(filter, 1, 200);
          if (cancelled) return;
          setLots(first.rows);
          setHasMoreLots(first.hasMore);
        }
        if (perBroker) {
          const brokers = payload.byBroker.map((b) => b.key).filter((k) => BROKERS[k]);
          const slices = await Promise.all(
            brokers.map(async (b) => ({
              label: brokerCode(b), broker: b,
              data: await api.mslFilteredAnalytics({ ...filter, brokers: [b] }),
            }))
          );
          if (!cancelled) setSubSlices(slices);
        }
        if (perMonth) {
          const keys = report.id === "month-grade-mix"
            ? payload.available.months.map((m) => Number(m.key))
            : [...new Set(payload.available.months.map((m) => Math.ceil(Number(m.key) / 3)))];
          const slices = await Promise.all(
            keys.map(async (k) => ({
              label: report.id === "month-grade-mix" ? `Month ${k}` : `Q${k}`,
              broker: "",
              data: await api.mslFilteredAnalytics(
                report.id === "month-grade-mix" ? { ...filter, months: [k] } : { ...filter, quarters: [k] }),
            }))
          );
          if (!cancelled) setSubSlices(slices);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Report failed to generate");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [report.id]);

  const loadMoreLots = async () => {
    const next = await api.mslFilteredLots(filter, lotsPage + 1, 200, lotSearch);
    setLots((prev) => [...prev, ...next.rows]);
    setLotsPage(lotsPage + 1);
    setHasMoreLots(next.hasMore);
  };

  const searchLots = async (term: string) => {
    setLotSearch(term);
    const first = await api.mslFilteredLots(filter, 1, 200, term);
    setLots(first.rows);
    setLotsPage(1);
    setHasMoreLots(first.hasMore);
  };

  const lotSearchBox = (
    <input
      className="border border-border rounded px-2.5 py-1.5 text-[12px] bg-surface outline-none focus:border-brass w-[260px] max-w-full mb-2"
      placeholder="Search lot no, mark, buyer, grade, invoice…"
      defaultValue={lotSearch}
      onKeyDown={(e) => {
        if (e.key === "Enter") searchLots((e.target as HTMLInputElement).value);
      }}
      onBlur={(e) => {
        if (e.target.value !== lotSearch) searchLots(e.target.value);
      }}
    />
  );

  const dimTable = (rows: FilteredSectionRow[], nameHeader: string, mapKey?: (r: FilteredSectionRow) => string) => (
    <Table
      headers={[nameHeader, "Lots", "Qty (kg)", "Sold %", "Sold qty (kg)", "Proceeds (Rs)", "Average (Rs)", "Best (Rs)"]}
      rows={rows.map((r) => [
        mapKey ? mapKey(r) : r.label && r.label !== r.key ? `${r.key} — ${r.label}` : r.key,
        nf.format(r.lots),
        nf.format(Math.round(r.totalQtyKg)),
        r.lots > 0 ? `${((r.soldLots / r.lots) * 100).toFixed(1)}%` : "—",
        nf.format(Math.round(r.soldQtyKg)),
        nf.format(Math.round(r.proceedsRs)),
        r.avgPriceRs != null ? nf2.format(r.avgPriceRs) : "—",
        r.maxPriceRs != null ? nf.format(r.maxPriceRs) : "—",
      ])}
    />
  );

  const body = () => {
    if (!data) return null;
    switch (report.id) {
      case "factory-grade-mix":
        return (
          <div className="flex flex-col gap-5">
            <GradeMixReport data={data} gradeClasses={gradeClasses} baseFilter={filter} />
            <div>
              <h4 className="text-[13px] font-semibold mb-1.5">Invoice Line Details</h4>
              {lotSearchBox}
              <LotLinesTable rows={lots} />
              {hasMoreLots && (
                <Button size="small" onClick={loadMoreLots} sx={{ mt: 1, fontSize: 12 }}>Load 200 more…</Button>
              )}
            </div>
          </div>
        );
      case "broker-grade-mix":
        return (
          <div className="flex flex-col gap-5">
            <div>
              <h4 className="text-[13px] font-semibold mb-1.5">Grade Mix (Sold) by Broker <span className="font-normal text-text-muted">| expand grade → packing</span></h4>
              <BrokerMatrix base={data} slices={subSlices} gradeClasses={gradeClasses} baseFilter={filter} mode="sold" />
            </div>
            <div>
              <h4 className="text-[13px] font-semibold mb-1.5">Broker Wise — Catalogued, Sold &amp; Asking <span className="font-normal text-text-muted">| expand category → grade → packing</span></h4>
              <DrillTable
                baseFilter={filter}
                rootRows={data.byBroker}
                levels={[
                  { ...drill.broker(), display: (r) => `${brokerCode(r.key)} — ${brokerName(r.key) ?? ""}` },
                  drill.category(), drill.grade(), drill.packing(),
                ]}
                mode="catalogue"
                qtyHeader="Catalogued qty"
                showAsking
                nameHeader="Broker"
              />
            </div>
            <div>
              <h4 className="text-[13px] font-semibold mb-1.5">Grade Mix (Unsold) by Broker</h4>
              <BrokerMatrix base={data} slices={subSlices} gradeClasses={gradeClasses} baseFilter={filter} mode="unsold" />
            </div>
          </div>
        );
      case "month-grade-mix":
      case "quarter-grade-mix":
        return (
          <div className="flex flex-col gap-5">
            {subSlices.map((s) => (
              <div key={s.label}>
                <div className="inline-block text-[12px] font-semibold text-white rounded px-2.5 py-1 mb-2"
                  style={{ background: "#1F3C6E" }}>
                  {s.label} — {nf.format(s.data.total.lots)} lots · avg {s.data.total.avgPriceRs != null ? nf2.format(s.data.total.avgPriceRs) : "—"}
                </div>
                <GradeMixReport data={s.data} gradeClasses={gradeClasses} baseFilter={filter} />
              </div>
            ))}
          </div>
        );
      case "invoice-lines":
        return (
          <div>
            {lotSearchBox}
            <LotLinesTable rows={lots} />
            {hasMoreLots && <Button size="small" onClick={loadMoreLots} sx={{ mt: 1, fontSize: 12 }}>Load 200 more…</Button>}
          </div>
        );
      case "elevation-wise":
        return (
          <DrillTable baseFilter={filter} rootRows={data.byElevation.filter((r) => r.label)}
            levels={[drill.elevation(), drill.grade(), drill.buyer()]} mode="catalogue" qtyHeader="Qty (kg)" nameHeader="Elevation" />
        );
      case "category-wise":
        return (
          <DrillTable baseFilter={filter} rootRows={data.byCategory}
            levels={[drill.category(), drill.grade(), drill.packing()]} mode="catalogue" qtyHeader="Qty (kg)" nameHeader="Category" />
        );
      case "price-range":
        return dimTable(data.byPriceRange, "Price range (Rs/kg)");
      case "buyer-wise":
        return (
          <DrillTable baseFilter={filter} rootRows={data.byBuyer.filter((b) => b.key !== "(none)")}
            levels={[drill.buyer(), drill.grade(), drill.packing()]} mode="sold" qtyHeader="Qty bought (kg)" nameHeader="Buyer" />
        );
      case "factory-wise":
        return (
          <DrillTable baseFilter={filter} rootRows={data.byFactory}
            levels={[drill.factory(), drill.grade(), drill.buyer()]} mode="catalogue" qtyHeader="Qty (kg)" nameHeader="Factory" />
        );
      case "broker-comparison":
        return dimTable(data.byBroker, "Broker", (r) => `${brokerCode(r.key)} — ${brokerName(r.key) ?? ""}`);
      case "catalogue-qty":
        return (
          <Table
            headers={["Broker", "Lots", "Catalogue qty (kg)", "Share"]}
            rows={data.byBroker.map((r) => [
              `${brokerCode(r.key)} — ${brokerName(r.key) ?? ""}`,
              nf.format(r.lots),
              nf.format(Math.round(r.totalQtyKg)),
              `${((r.totalQtyKg / (data.total.totalQtyKg || 1)) * 100).toFixed(2)}%`,
            ])}
          />
        );
      case "sold-unsold":
        return (
          <div className="flex flex-col gap-4">
            <div className="flex gap-8 flex-wrap">
              <SoldPie sold={data.total.soldQtyKg} unsold={data.total.totalQtyKg - data.total.soldQtyKg} />
              <OkloPie rows={data.byOkloStatus} />
            </div>
            {dimTable(data.byBroker, "Broker", (r) => `${brokerCode(r.key)} — ${brokerName(r.key) ?? ""}`)}
          </div>
        );
      default:
        return <p className="text-text-muted">Unknown report.</p>;
    }
  };

  return (
    <Dialog open fullScreen onClose={onClose}>
      <div className="report-print-area flex flex-col h-full bg-paper-0">
        <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border print:hidden">
          <h3 className="m-0 font-display text-[15px] font-semibold text-text-strong">{report.title}</h3>
          <span className="text-[11.5px] text-text-muted truncate">{filterSummary(filter)}</span>
          <span className="ml-auto" />
          <Button size="small" startIcon={<PrintOutlinedIcon />} onClick={() => window.print()} sx={{ fontSize: 12 }}>
            Print / PDF
          </Button>
          <IconButton size="small" onClick={onClose}><CloseIcon fontSize="small" /></IconButton>
        </div>
        <div className="hidden print:block px-4 pt-3">
          <h2 className="m-0 text-[16px] font-semibold">{report.title} — ASC Intelligence Hub</h2>
          <p className="m-0 text-[11px]">{filterSummary(filter)} · generated {new Date().toLocaleString()}</p>
        </div>
        <div className="px-4 pt-3">
          <div className="flex items-center gap-1.5 flex-wrap rounded-md border border-border bg-surface-sunken/40 px-2.5 py-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted">You are viewing:</span>
            {filterSummary(filter).split(" · ").map((part) => (
              <span key={part} className="text-[11.5px] px-2 py-0.5 rounded-full text-white" style={{ background: "#1F3C6E" }}>
                {part}
              </span>
            ))}
          </div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex flex-col items-center pt-20 gap-3">
              <TeaLoader size={64} />
              <span className="text-[12.5px] text-text">Generating {report.title}…</span>
            </div>
          ) : error ? (
            <div className="p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
          ) : (
            body()
          )}
        </div>
      </div>
    </Dialog>
  );
}
