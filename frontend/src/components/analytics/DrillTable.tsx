"use client";

import { api } from "@/lib/api";
import type { FilteredAnalytics, FilteredSectionRow, MslAnalyticsFilter } from "@/types/api";
import { Fragment, useState } from "react";

/* =====================================================================
   DRILL TABLE — Power BI-style expandable hierarchy for report tables.
   Every level's children load lazily: expanding a row narrows the
   filter (grade → packing → buyer, …) and fetches that slice's section
   from the cached analytics endpoint, so drilling is instant on repeat
   and never bloats the initial payload.
   ===================================================================== */

const nf = new Intl.NumberFormat("en-US");
const nf2 = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type DrillMode = "sold" | "unsold" | "catalogue";

export interface DrillLevel {
  /** Which section of the payload holds this level's rows. */
  section: (d: FilteredAnalytics) => FilteredSectionRow[];
  /** Filter narrowing applied when a row of this level is expanded. */
  patch: (row: FilteredSectionRow) => Partial<MslAnalyticsFilter>;
  /** Row label; defaults to `label ?? key`. */
  display?: (row: FilteredSectionRow) => string;
  /** Rows that can't be drilled further (e.g. "(none)" packing). */
  leafIf?: (row: FilteredSectionRow) => boolean;
  /** Synchronous children already present in the loaded payload (no fetch needed). */
  childrenOf?: (row: FilteredSectionRow) => FilteredSectionRow[];
}

interface NodeState {
  children?: FilteredSectionRow[];
  loading?: boolean;
  open: boolean;
}

function qtyOf(r: FilteredSectionRow, mode: DrillMode): number {
  return mode === "sold" ? r.soldQtyKg : mode === "unsold" ? r.totalQtyKg - r.soldQtyKg : r.totalQtyKg;
}

export default function DrillTable({
  baseFilter, rootRows, levels, mode = "sold", totalQty, showAsking = false, qtyHeader, nameHeader = "Item", openByDefault = false,
}: {
  baseFilter: MslAnalyticsFilter;
  /** Level-0 rows (from the already-loaded payload). */
  rootRows: FilteredSectionRow[];
  /** levels[0] describes level-0's patch + the section for its CHILDREN, etc. */
  levels: DrillLevel[];
  mode?: DrillMode;
  /** Denominator for the % column; defaults to the sum of root rows. */
  totalQty?: number;
  showAsking?: boolean;
  qtyHeader?: string;
  nameHeader?: string;
  /** Start with level-0 rows expanded (their children must come from childrenOf). */
  openByDefault?: boolean;
}) {
  const [nodes, setNodes] = useState<Record<string, NodeState>>(() => {
    if (!openByDefault) return {};
    const initial: Record<string, NodeState> = {};
    for (const r of rootRows) {
      const kids = levels[0]?.childrenOf?.(r);
      if (kids) initial[`/${r.key}`] = { open: true, children: kids.filter((k) => qtyOf(k, mode) > 0) };
    }
    return initial;
  });
  const [visible, setVisible] = useState(50);
  const denominator = totalQty ?? (rootRows.reduce((s, r) => s + qtyOf(r, mode), 0) || 1);

  const toggle = async (path: string, depth: number, row: FilteredSectionRow, accFilter: MslAnalyticsFilter) => {
    const cur = nodes[path];
    if (cur?.open) {
      setNodes((n) => ({ ...n, [path]: { ...cur, open: false } }));
      return;
    }
    if (cur?.children) {
      setNodes((n) => ({ ...n, [path]: { ...cur, open: true } }));
      return;
    }
    const nextLevel = levels[depth + 1];
    if (!nextLevel) return;
    const sync = levels[depth].childrenOf?.(row);
    if (sync) {
      setNodes((n) => ({ ...n, [path]: { open: true, children: sync.filter((r2) => qtyOf(r2, mode) > 0) } }));
      return;
    }
    setNodes((n) => ({ ...n, [path]: { open: true, loading: true } }));
    try {
      const payload = await api.mslFilteredAnalytics({ ...accFilter, ...levels[depth].patch(row) });
      const kids = nextLevel.section(payload).filter((r) => qtyOf(r, mode) > 0);
      setNodes((n) => ({ ...n, [path]: { open: true, children: kids } }));
    } catch {
      setNodes((n) => ({ ...n, [path]: { open: false } }));
    }
  };

  const renderRows = (
    rows: FilteredSectionRow[], depth: number, pathPrefix: string, accFilter: MslAnalyticsFilter
  ): React.ReactNode =>
    rows.map((row) => {
      const path = `${pathPrefix}/${row.key}`;
      const state = nodes[path];
      const level = levels[depth];
      const expandable = depth + 1 < levels.length && !(level.leafIf?.(row) ?? false);
      const q = qtyOf(row, mode);
      const label = level.display ? level.display(row) : row.label && row.label !== row.key ? `${row.key} — ${row.label}` : row.key;
      const childFilter = { ...accFilter, ...level.patch(row) };
      return (
        <Fragment key={path}>
          <tr className={`border-b border-border/50 ${depth === 0 ? "bg-surface-sunken/60 font-semibold text-text-strong" : "hover:bg-surface-sunken/30"}`}>
            <td className="px-2.5 py-1 whitespace-nowrap" style={{ paddingLeft: `${10 + depth * 18}px` }}>
              {expandable ? (
                <button
                  onClick={() => toggle(path, depth, row, accFilter)}
                  className="inline-flex items-center gap-1 text-left"
                  aria-expanded={state?.open ?? false}
                >
                  <span className="inline-block w-4 text-brass font-bold">
                    {state?.loading ? "…" : state?.open ? "−" : "+"}
                  </span>
                  {label}
                </button>
              ) : (
                <span className="pl-5">{label}</span>
              )}
            </td>
            <td className="px-2.5 py-1 text-right tabular-nums whitespace-nowrap">{nf.format(Math.round(q))}</td>
            <td className="px-2.5 py-1 text-right tabular-nums whitespace-nowrap">{((q / denominator) * 100).toFixed(2)}%</td>
            {mode !== "unsold" && (
              <td className="px-2.5 py-1 text-right tabular-nums whitespace-nowrap">
                {row.avgPriceRs != null ? nf2.format(row.avgPriceRs) : "—"}
              </td>
            )}
            {showAsking && (
              <td className="px-2.5 py-1 text-right tabular-nums whitespace-nowrap">
                {row.askingAvgRs != null ? nf2.format(row.askingAvgRs) : "—"}
              </td>
            )}
          </tr>
          {state?.open && state.children && renderRows(state.children, depth + 1, path, childFilter)}
          {state?.open && state.children?.length === 0 && (
            <tr><td colSpan={3 + (mode !== "unsold" ? 1 : 0) + (showAsking ? 1 : 0)} className="px-2.5 py-1 text-[11px] text-text-muted" style={{ paddingLeft: `${28 + depth * 18}px` }}>Nothing below this.</td></tr>
          )}
        </Fragment>
      );
    });

  const shown = rootRows.filter((r) => qtyOf(r, mode) > 0).slice(0, visible);
  const rootCount = rootRows.filter((r) => qtyOf(r, mode) > 0).length;

  return (
    <div
      className="overflow-auto border border-border rounded max-h-[480px] print:max-h-none"
      onScroll={(e) => {
        const el = e.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 120 && visible < rootCount) setVisible((v) => v + 50);
      }}
    >
      <table className="w-full text-[12px] border-collapse">
        <thead className="sticky top-0 z-[1]">
          <tr className="text-left text-white" style={{ background: "#1F3C6E" }}>
            <th className="px-2.5 py-1.5 font-medium whitespace-nowrap">{nameHeader}</th>
            <th className="px-2.5 py-1.5 font-medium text-right whitespace-nowrap">{qtyHeader ?? (mode === "unsold" ? "QTY unsold" : mode === "sold" ? "QTY sold" : "QTY (kg)")}</th>
            <th className="px-2.5 py-1.5 font-medium text-right whitespace-nowrap">%</th>
            {mode !== "unsold" && <th className="px-2.5 py-1.5 font-medium text-right whitespace-nowrap">Average</th>}
            {showAsking && <th className="px-2.5 py-1.5 font-medium text-right whitespace-nowrap">Asking avg</th>}
          </tr>
        </thead>
        <tbody>
          {renderRows(shown, 0, "", baseFilter)}
          {visible < rootCount && (
            <tr><td colSpan={5} className="px-3 py-2 text-center text-[11px] text-text-muted">Showing {visible} of {rootCount} — scroll for more</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

/** Shared level builders for the report definitions. */
export const drill = {
  gradeType: (): DrillLevel => ({
    section: () => [],
    patch: (r) => ({ gradeTypes: [r.key] }),
    display: (r) => r.key,
    // level-0 rows for grade types are computed by the caller from byGrade + classes
    leafIf: () => false,
  }),
  grade: (): DrillLevel => ({
    section: (d) => d.byGrade,
    patch: (r) => ({ grades: [r.key] }),
    display: (r) => r.key,
  }),
  packing: (): DrillLevel => ({
    section: (d) => d.byPacking,
    patch: (r) => ({ packings: [Number(r.key)] }),
    display: (r) => (r.key === "(none)" ? "(no packing data)" : `${r.key} kg packing`),
    leafIf: (r) => r.key === "(none)",
  }),
  buyer: (): DrillLevel => ({
    section: (d) => d.byBuyer.filter((b) => b.key !== "(none)"),
    patch: (r) => ({ buyers: [r.key] }),
    display: (r) => r.label ?? r.key,
  }),
  category: (): DrillLevel => ({
    section: (d) => d.byCategory,
    patch: (r) => ({ categories: [r.key] }),
  }),
  elevation: (): DrillLevel => ({
    section: (d) => d.byElevation.filter((e) => e.label),
    patch: (r) => ({ elevations: [r.label ?? r.key] }),
    display: (r) => r.label ?? r.key,
  }),
  broker: (): DrillLevel => ({
    section: (d) => d.byBroker,
    patch: (r) => ({ brokers: [r.key] }),
  }),
  factory: (): DrillLevel => ({
    section: (d) => d.byFactory,
    patch: (r) => ({ factories: [r.key] }),
  }),
  mark: (): DrillLevel => ({
    section: (d) => d.byMark,
    patch: (r) => ({ marks: [r.key] }),
  }),
};
