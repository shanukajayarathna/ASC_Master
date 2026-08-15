"use client";

import PageHeader from "@/components/shared/PageHeader";
import { SkeletonRows } from "@/components/shared/SkeletonBlock";
import { api } from "@/lib/api";
import type { MslAggregateRow, MslFilters, MslSearchResult, MslStatus } from "@/types/api";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/* =====================================================================
   MASTER SEARCH — the full MSL auction archive (2013–present).
   One filter bar drives two views of the same filtered slice:
     • Lots — the matching rows themselves, paged.
     • Grouped — averages/quantities grouped by grade, elevation, year,
       mark, buyer, broker or estate.
   The aggregate strip on top always reflects the whole filtered slice,
   not just the visible page. Data arrives via the MSL folder watcher —
   dropping a new week's files into data/msl updates this page with no
   manual import step.
   ===================================================================== */

const ELEVATIONS = ["", "UVA HIGH", "WESTERN HIGH", "UVA MEDIUM", "WESTERN MEDIUM", "LOW"];
const BROKERS = ["", "AS", "BTL", "DES", "EB", "FBS", "JK", "LCB", "MB"];
const GROUPINGS = [
  { key: "grade", label: "By grade" },
  { key: "elevation", label: "By elevation" },
  { key: "year", label: "By year" },
  { key: "mark", label: "By selling mark" },
  { key: "estate", label: "By estate" },
  { key: "buyer", label: "By buyer" },
  { key: "broker", label: "By broker" },
] as const;

const nf = new Intl.NumberFormat("en-US");
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtKg = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(2)}M` : nf.format(Math.round(v)));

function StatTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="border border-border rounded-md bg-surface px-3.5 py-2.5 min-w-[130px]">
      <div className="text-[11px] uppercase tracking-wide text-text-muted">{label}</div>
      <div className="font-display text-[17px] font-semibold text-text-strong leading-snug">{value}</div>
      {hint && <div className="text-[11px] text-text-muted">{hint}</div>}
    </div>
  );
}

const inputCls =
  "border border-border rounded-md bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-brass";

export default function MasterSearchPage() {
  const [status, setStatus] = useState<MslStatus | null>(null);
  const [filters, setFilters] = useState<MslFilters>({});
  const [view, setView] = useState<"lots" | (typeof GROUPINGS)[number]["key"]>("lots");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<MslSearchResult | null>(null);
  const [groups, setGroups] = useState<MslAggregateRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Text inputs are debounced into `filters`; selects apply immediately through the same setter.
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const setFilter = useCallback((patch: Partial<MslFilters>, debounced = false) => {
    const apply = () => {
      setPage(1);
      setFilters((f) => ({ ...f, ...patch }));
    };
    if (debounce.current) clearTimeout(debounce.current);
    if (debounced) debounce.current = setTimeout(apply, 400);
    else apply();
  }, []);

  useEffect(() => {
    api.mslStatus().then(setStatus).catch(() => {});
  }, []);

  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(null);
    const load =
      view === "lots"
        ? api.mslSearch(filters, page, 50).then((r) => {
            if (!cancelled) setResult(r);
          })
        : api.mslAggregate(view, filters, 100).then((g) => {
            if (!cancelled) setGroups(g);
          });
    load
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : "Search failed"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filters, page, view]);

  const agg = result?.aggregate;
  const soldPct = agg && agg.lots > 0 ? ((agg.soldLots / agg.lots) * 100).toFixed(1) : null;
  const totalPages = result ? Math.max(1, Math.ceil(result.total / 50)) : 1;
  const yearSpan = useMemo(() => {
    const ys = status?.years ?? [];
    return ys.length ? `${ys[0].year}–${ys[ys.length - 1].year}` : "";
  }, [status]);

  return (
    <div>
      <PageHeader
        title="Master Search"
        subtitle={`Search the full auction archive${yearSpan ? ` (${yearSpan})` : ""} — every lot, price, buyer and estate across all brokers, plus private sales.${
          status ? ` ${nf.format(status.totalLots)} lots indexed.` : ""
        }`}
      />

      {/* ---- filter bar ---- */}
      <div className="flex flex-wrap gap-2 mb-3 items-center">
        <input
          className={`${inputCls} w-64`}
          placeholder="Estate, mark, factory code or buyer…"
          defaultValue={filters.q ?? ""}
          onChange={(e) => setFilter({ q: e.target.value || undefined }, true)}
        />
        <select className={inputCls} value={filters.elevation ?? ""} onChange={(e) => setFilter({ elevation: e.target.value || undefined })}>
          {ELEVATIONS.map((el) => (
            <option key={el} value={el}>
              {el || "All elevations"}
            </option>
          ))}
        </select>
        <select className={inputCls} value={filters.broker ?? ""} onChange={(e) => setFilter({ broker: e.target.value || undefined })}>
          {BROKERS.map((b) => (
            <option key={b} value={b}>
              {b || "All brokers"}
            </option>
          ))}
        </select>
        <input
          className={`${inputCls} w-24`}
          placeholder="Grade"
          defaultValue={filters.grade ?? ""}
          onChange={(e) => setFilter({ grade: e.target.value || undefined }, true)}
        />
        <input
          className={`${inputCls} w-24`}
          type="number"
          placeholder="Year from"
          defaultValue={filters.yearFrom ?? ""}
          onChange={(e) => setFilter({ yearFrom: e.target.value ? Number(e.target.value) : undefined }, true)}
        />
        <input
          className={`${inputCls} w-24`}
          type="number"
          placeholder="Year to"
          defaultValue={filters.yearTo ?? ""}
          onChange={(e) => setFilter({ yearTo: e.target.value ? Number(e.target.value) : undefined }, true)}
        />
        <select
          className={inputCls}
          value={filters.sold === undefined ? "" : String(filters.sold)}
          onChange={(e) => setFilter({ sold: e.target.value === "" ? undefined : e.target.value === "true" })}
        >
          <option value="">Sold + unsold</option>
          <option value="true">Sold only</option>
          <option value="false">Unsold only</option>
        </select>
        <select
          className={inputCls}
          value={filters.isPrivate === undefined ? "" : String(filters.isPrivate)}
          onChange={(e) => setFilter({ isPrivate: e.target.value === "" ? undefined : e.target.value === "true" })}
        >
          <option value="">Auction + private</option>
          <option value="false">Public auction</option>
          <option value="true">Private sales</option>
        </select>
      </div>

      {/* ---- aggregate strip (always the whole filtered slice) ---- */}
      {agg && (
        <div className="flex flex-wrap gap-2 mb-4">
          <StatTile label="Lots" value={nf.format(agg.lots)} hint={soldPct ? `${soldPct}% sold` : undefined} />
          <StatTile label="Quantity" value={`${fmtKg(agg.totalQtyKg)} kg`} hint={`${fmtKg(agg.soldQtyKg)} kg sold`} />
          <StatTile label="Weighted avg" value={agg.weightedAvgRs != null ? `Rs ${nf2.format(agg.weightedAvgRs)}` : "—"} hint="sold lots, qty-weighted" />
          <StatTile
            label="Price range"
            value={agg.minPriceRs != null && agg.maxPriceRs != null ? `${nf.format(agg.minPriceRs)}–${nf.format(agg.maxPriceRs)}` : "—"}
            hint="Rs/kg"
          />
        </div>
      )}

      {/* ---- view tabs ---- */}
      <div className="flex flex-wrap gap-1.5 mb-3">
        {[{ key: "lots" as const, label: "Lots" }, ...GROUPINGS].map((t) => (
          <button
            key={t.key}
            onClick={() => setView(t.key)}
            className={`px-3 py-1.5 rounded-md text-[12.5px] border ${
              view === t.key
                ? "border-brass bg-brass/10 text-text-strong font-semibold"
                : "border-border bg-surface text-text-muted hover:text-text"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>}

      {loading ? (
        <SkeletonRows rows={8} />
      ) : view === "lots" ? (
        <>
          <div className="overflow-x-auto border border-border rounded-md">
            <table className="w-full text-[12px] border-collapse">
              <thead>
                <tr className="bg-surface text-left text-text-muted">
                  {["Sale", "Date", "Broker", "Lot", "Selling mark", "Estate", "Grade", "Elevation", "Qty (kg)", "Price (Rs)", "Buyer"].map((h) => (
                    <th key={h} className="px-2.5 py-2 font-medium whitespace-nowrap border-b border-border">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result?.items.map((l, i) => (
                  <tr key={i} className="border-b border-border/60 hover:bg-surface">
                    <td className="px-2.5 py-1.5 whitespace-nowrap">
                      {l.isPrivate ? `PVT ${l.saleYear}` : `${String(l.saleNo).padStart(2, "0")}/${l.saleYear}`}
                    </td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{l.saleDate.slice(0, 10)}</td>
                    <td className="px-2.5 py-1.5">{l.broker ?? "—"}</td>
                    <td className="px-2.5 py-1.5">{l.lotNo}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{l.sellingMark}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{l.estateName}</td>
                    <td className="px-2.5 py-1.5">{l.grade}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{l.elevation ?? "—"}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(l.quantityKg)}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{l.sold ? nf2.format(l.priceRs) : <span className="text-text-muted">unsold</span>}</td>
                    <td className="px-2.5 py-1.5 whitespace-nowrap">{l.buyerName ?? "—"}</td>
                  </tr>
                ))}
                {result?.items.length === 0 && (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-text-muted">
                      No lots match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3 mt-3 text-[12.5px] text-text-muted">
            <button
              className="px-2.5 py-1 border border-border rounded disabled:opacity-40"
              disabled={page <= 1}
              onClick={() => setPage((p) => p - 1)}
            >
              ← Prev
            </button>
            <span>
              Page {page} of {nf.format(totalPages)} · {result ? nf.format(result.total) : 0} lots
            </span>
            <button
              className="px-2.5 py-1 border border-border rounded disabled:opacity-40"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next →
            </button>
          </div>
        </>
      ) : (
        <div className="overflow-x-auto border border-border rounded-md">
          <table className="w-full text-[12px] border-collapse">
            <thead>
              <tr className="bg-surface text-left text-text-muted">
                {[GROUPINGS.find((g) => g.key === view)?.label.replace("By ", "") ?? "Key", "Lots", "Sold", "Qty (kg)", "Sold qty (kg)", "Weighted avg (Rs)", "Min (Rs)", "Max (Rs)"].map((h) => (
                  <th key={h} className="px-2.5 py-2 font-medium whitespace-nowrap border-b border-border">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups?.map((g) => (
                <tr key={g.key} className="border-b border-border/60 hover:bg-surface">
                  <td className="px-2.5 py-1.5 whitespace-nowrap font-medium text-text-strong">{g.key}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(g.lots)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(g.soldLots)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(g.totalQtyKg)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{nf.format(g.soldQtyKg)}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{g.weightedAvgRs != null ? nf2.format(g.weightedAvgRs) : "—"}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{g.minPriceRs != null ? nf.format(g.minPriceRs) : "—"}</td>
                  <td className="px-2.5 py-1.5 text-right tabular-nums">{g.maxPriceRs != null ? nf.format(g.maxPriceRs) : "—"}</td>
                </tr>
              ))}
              {groups?.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-text-muted">
                    Nothing to group — adjust the filters.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
