"use client";

import type { AvailableOptions, MslAnalyticsFilter, MslFilterOptions, OptionRow } from "@/types/api";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { useMemo, useState } from "react";

/* =====================================================================
   FILTRATION PANEL — Power BI-slicer style, like the portal screenshots:
   every filter is a visible, scrollable CHECKLIST (options + lot counts
   shown up front, ticked to select), with a search box on the long
   lists. All boxes cascade from the current filtered payload: pick 2026
   and every list reshapes to what 2026 actually contains.
   ===================================================================== */

const nf = new Intl.NumberFormat("en-US");

/** One slicer box: visible checkbox list, selected items pinned on top.
 *  `nameOnly` shows the label instead of "key · label" (e.g. buyers without codes). */
function Slicer({
  title, rows, value, onChange, searchable = false, tall = false, nameOnly = false,
}: {
  title: string;
  rows: OptionRow[];
  value: string[];
  onChange: (v: string[]) => void;
  searchable?: boolean;
  tall?: boolean;
  nameOnly?: boolean;
}) {
  const [q, setQ] = useState("");

  const shown = useMemo(() => {
    // Selected values always stay listed (even if the slice no longer contains them).
    const present = new Set(rows.map((r) => r.key));
    const extras = value.filter((v) => !present.has(v)).map((v) => ({ key: v, label: null, lots: 0 }));
    let all = [...extras, ...rows];
    if (q.trim()) {
      const needle = q.trim().toUpperCase();
      all = all.filter((r) => (r.key + " " + (r.label ?? "")).toUpperCase().includes(needle));
    }
    const sel = new Set(value);
    return all.sort((a, b) => (sel.has(b.key) ? 1 : 0) - (sel.has(a.key) ? 1 : 0));
  }, [rows, value, q]);

  const toggle = (k: string) =>
    onChange(value.includes(k) ? value.filter((x) => x !== k) : [...value, k]);

  return (
    <div className="border border-border rounded-md bg-surface min-w-0 flex flex-col">
      <div className="flex items-center justify-between gap-1 px-2.5 pt-2 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-text-muted truncate">{title}</span>
        {value.length > 0 && (
          <button className="text-[10.5px] text-brass shrink-0" onClick={() => onChange([])}>
            clear {value.length}
          </button>
        )}
      </div>
      {searchable && (
        <div className="px-2.5 pb-1.5">
          <input
            className="w-full border border-border rounded px-2 py-1 text-[11.5px] bg-surface outline-none focus:border-brass"
            placeholder="Search…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
      )}
      <div className={`overflow-y-auto px-1.5 pb-1.5 ${tall ? "h-[190px]" : "max-h-[150px]"}`}>
        {shown.map((r) => (
          <label
            key={r.key}
            className={`flex items-center gap-1.5 px-1 py-[3px] rounded cursor-pointer text-[12px] hover:bg-surface-sunken/50 ${
              value.includes(r.key) ? "text-text-strong font-medium" : "text-text"
            }`}
          >
            <input
              type="checkbox"
              className="accent-[var(--brand-gold)] shrink-0"
              checked={value.includes(r.key)}
              onChange={() => toggle(r.key)}
            />
            <span className="truncate flex-1">
              {nameOnly ? (r.label ?? r.key) : r.key}
              {!nameOnly && r.label && r.label !== r.key && <span className="text-text-muted"> · {r.label}</span>}
            </span>
            {r.lots > 0 && <span className="text-[10px] text-text-muted shrink-0 tabular-nums">{nf.format(r.lots)}</span>}
          </label>
        ))}
        {shown.length === 0 && <p className="text-[11.5px] text-text-muted px-1 py-2 m-0">Nothing in this slice.</p>}
      </div>
    </div>
  );
}

function InputBox({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border border-border rounded-md bg-surface p-2.5 min-w-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-text-muted mb-1.5">{title}</div>
      {children}
    </div>
  );
}

const MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

export default function FilterPanel({
  options, available, filter, onChange,
}: {
  options: MslFilterOptions;
  available: AvailableOptions | null;
  filter: MslAnalyticsFilter;
  onChange: (f: MslAnalyticsFilter) => void;
}) {
  const set = (patch: Partial<MslAnalyticsFilter>) => onChange({ ...filter, ...patch });
  const list = (v: string[]): string[] | undefined => (v.length ? v : undefined);

  const gradeRows = available?.grades ?? options.grades.map((g) => ({ key: g, label: null, lots: 0 }));
  const buyerRows = available?.buyers ?? options.buyers.map((b) => ({ key: b, label: options.buyerNames[b] ?? null, lots: 0 }));
  const markRows = available?.marks ?? [];
  const factoryRows = available?.factories ?? [];
  const groupRows = available?.groups ?? options.groups.map((g) => ({ key: g, label: null, lots: 0 }));

  // Category / grade-type / tea-type / CTC all derive from the AVAILABLE grades'
  // classifications — so they shrink with the slice exactly like everything else.
  const classify = useMemo(() => {
    const make = (idx: number, fallback: string[]) => {
      const counts = new Map<string, number>();
      for (const g of gradeRows) {
        const cls = options.gradeClasses[g.key];
        if (cls) counts.set(cls[idx], (counts.get(cls[idx]) ?? 0) + g.lots);
      }
      const rows = [...counts.entries()].map(([k, lots]) => ({ key: k, label: null, lots }));
      return rows.length ? rows.sort((a, b) => b.lots - a.lots) : fallback.map((c) => ({ key: c, label: null, lots: 0 }));
    };
    return {
      categories: make(0, options.categories),
      gradeTypes: make(1, options.gradeTypes),
      teaTypes: make(2, options.teaTypes),
      manufactures: make(3, options.manufactures),
    };
  }, [gradeRows, options]);
  const categoryRows = classify.categories;

  // Months (and quarters, derived) cascade from the slice's sale dates.
  const monthRows = useMemo(() => {
    const avail = available?.months ?? [];
    if (avail.length === 0)
      return MONTH_NAMES.map((m, i) => ({ key: String(i + 1), label: m, lots: 0 }));
    return avail.map((m) => ({ key: m.key, label: MONTH_NAMES[Number(m.key) - 1] ?? m.key, lots: m.lots }));
  }, [available]);
  const quarterRows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const m of monthRows) counts.set(String(Math.ceil(Number(m.key) / 3)), (counts.get(String(Math.ceil(Number(m.key) / 3))) ?? 0) + m.lots);
    return ["1", "2", "3", "4"]
      .filter((qn) => counts.has(qn) || monthRows.every((m) => m.lots === 0))
      .map((qn) => ({ key: qn, label: `Q${qn}`, lots: counts.get(qn) ?? 0 }));
  }, [monthRows]);

  // Mark types present in the slice, from the available factory codes.
  const markTypeRows = useMemo(() => {
    const src = available?.factories ?? [];
    if (src.length === 0) return options.markTypes.map((m) => ({ key: m, label: `${m} Mark`, lots: 0 }));
    const counts = new Map<string, number>();
    for (const f of src) {
      const prefix = f.key.slice(0, 2).toUpperCase();
      counts.set(prefix, (counts.get(prefix) ?? 0) + f.lots);
    }
    return [...counts.entries()].map(([k, lots]) => ({ key: k, label: `${k} Mark`, lots })).sort((a, b) => b.lots - a.lots);
  }, [available, options]);

  // Year and Sale No come from the STATIC sales list (never self-cascading — you must
  // always be able to switch year/sale), scoped: sale numbers shown for selected years.
  const yearRows = useMemo(() => {
    const byYear = new Map<number, number>();
    for (const s of options.sales) byYear.set(s.year, (byYear.get(s.year) ?? 0) + s.lots);
    return options.years.map((y) => ({ key: String(y), label: null, lots: byYear.get(y) ?? 0 }));
  }, [options]);
  const saleRows = useMemo(() => {
    const years = new Set((filter.years ?? []).map(String));
    return options.sales
      .filter((s) => years.size === 0 || years.has(String(s.year)))
      .map((s) => ({
        key: String(s.saleNo),
        label: s.saleNo === 0 ? `Private · ${s.year}` : `${s.saleDate.slice(0, 10)}`,
        lots: s.lots,
      }))
      .sort((a, b) => Number(b.key) - Number(a.key));
  }, [options, filter.years]);

  const activeCount =
    (filter.years?.length ?? 0) + (filter.saleNos?.length ?? 0) +
    (filter.months?.length ?? 0) + (filter.quarters?.length ?? 0) + (filter.brokers?.length ?? 0) +
    (filter.elevations?.length ?? 0) + (filter.categories?.length ?? 0) + (filter.grades?.length ?? 0) +
    (filter.buyers?.length ?? 0) + (filter.marks?.length ?? 0) + (filter.factories?.length ?? 0) +
    (filter.groups?.length ?? 0) + (filter.markTypes?.length ?? 0) + (filter.teaTypes?.length ?? 0) +
    (filter.manufactures?.length ?? 0) + (filter.gradeTypes?.length ?? 0) +
    (filter.lotNos?.length ?? 0) + (filter.invoices?.length ?? 0) +
    (filter.bags?.length ?? 0) + (filter.packings?.length ?? 0) + (filter.districts?.length ?? 0) +
    (filter.saleType ? 1 : 0) + (filter.soldStatus ? 1 : 0) + (filter.refuseTea ? 1 : 0) +
    (filter.sharingStatus ? 1 : 0) + (filter.organic ? 1 : 0) + (filter.markSearch ? 1 : 0) +
    (filter.priceMin != null || filter.priceMax != null ? 1 : 0);

  return (
    <div className="border border-border rounded-md bg-surface-sunken/30 p-3 mb-4">
      <div className="flex items-center gap-2 mb-2.5">
        <span className="text-[12.5px] font-semibold text-text-strong">Filtration</span>
        {activeCount > 0 && (
          <>
            <Chip label={`${activeCount} active`} size="small" sx={{ fontSize: 11 }} />
            <button
              className="text-[11.5px] text-text-muted underline"
              onClick={() => onChange({ years: filter.years, saleNos: filter.saleNos })}
            >
              Clear all
            </button>
          </>
        )}
        <span className="text-[11px] text-text-muted ml-auto">
          Counts show lots in the current slice — every box reshapes as you select.
        </span>
      </div>

      <div className="grid gap-2.5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(195px, 1fr))" }}>
        <Slicer title="Sale year" value={(filter.years ?? []).map(String)} rows={yearRows}
          onChange={(v) => set({ years: v.length ? v.map(Number) : undefined, saleNos: undefined })} />
        <Slicer title="Sale no" searchable tall value={(filter.saleNos ?? []).map(String)} rows={saleRows}
          onChange={(v) => set({ saleNos: v.length ? v.map(Number) : undefined })} />
        <Slicer title="Sale month" value={(filter.months ?? []).map(String)} rows={monthRows}
          onChange={(v) => set({ months: v.length ? v.map(Number) : undefined })} />
        <Slicer title="Quarter" value={(filter.quarters ?? []).map(String)} rows={quarterRows}
          onChange={(v) => set({ quarters: v.length ? v.map(Number) : undefined })} />
        <Slicer title="Broker" value={filter.brokers ?? []}
          rows={available?.brokers ?? options.brokers.map((b) => ({ key: b, label: null, lots: 0 }))}
          onChange={(v) => set({ brokers: list(v) })} />
        <Slicer title="Elevation" value={filter.elevations ?? []}
          rows={available?.elevations ?? options.elevations.map((e) => ({ key: e.label ?? e.key, label: null, lots: 0 }))}
          onChange={(v) => set({ elevations: list(v) })} />
        <Slicer title="Category" value={filter.categories ?? []} rows={categoryRows}
          onChange={(v) => set({ categories: list(v) })} />
        <Slicer title="Grade" searchable tall value={filter.grades ?? []} rows={gradeRows}
          onChange={(v) => set({ grades: list(v) })} />
        <Slicer title="Buyer" searchable tall nameOnly value={filter.buyers ?? []} rows={buyerRows}
          onChange={(v) => set({ buyers: list(v) })} />
        <Slicer title="Selling mark" searchable tall value={filter.marks ?? []} rows={markRows}
          onChange={(v) => set({ marks: list(v) })} />
        <Slicer title="Factory" searchable tall value={filter.factories ?? []} rows={factoryRows}
          onChange={(v) => set({ factories: list(v) })} />
        <Slicer title="Plantation group" searchable tall value={filter.groups ?? []} rows={groupRows}
          onChange={(v) => set({ groups: list(v) })} />
        <Slicer title="Mark type" value={filter.markTypes ?? []} rows={markTypeRows}
          onChange={(v) => set({ markTypes: list(v) })} />
        <Slicer title="Sale type" value={filter.saleType ? [filter.saleType] : []}
          rows={available?.saleTypes ?? [{ key: "public", label: "Public auction", lots: 0 }, { key: "private", label: "Private sale", lots: 0 }]}
          onChange={(v) => set({ saleType: (v.at(-1) ?? null) as MslAnalyticsFilter["saleType"] })} />
        <Slicer title="Sold status" value={filter.soldStatus ? [filter.soldStatus] : []}
          rows={available?.soldStatuses ?? [{ key: "sold", label: "Sold", lots: 0 }, { key: "unsold", label: "Unsold", lots: 0 }]}
          onChange={(v) => set({ soldStatus: (v.at(-1) ?? null) as MslAnalyticsFilter["soldStatus"] })} />
        <Slicer title="Refused tea" value={filter.refuseTea ? [filter.refuseTea] : []}
          rows={available?.refuseTea ?? [{ key: "exclude", label: "Non refused tea", lots: 0 }, { key: "only", label: "Refused tea", lots: 0 }]}
          onChange={(v) => set({ refuseTea: (v.at(-1) ?? null) as MslAnalyticsFilter["refuseTea"] })} />
        <Slicer title="Tea type" value={filter.teaTypes ?? []} rows={classify.teaTypes}
          onChange={(v) => set({ teaTypes: list(v) })} />
        <Slicer title="CTC status" value={filter.manufactures ?? []} rows={classify.manufactures}
          onChange={(v) => set({ manufactures: list(v) })} />
        <Slicer title="Grade type" value={filter.gradeTypes ?? []} rows={classify.gradeTypes}
          onChange={(v) => set({ gradeTypes: list(v) })} />
        <Slicer title="Lot no" searchable tall value={filter.lotNos ?? []}
          rows={available?.lotNos ?? []}
          onChange={(v) => set({ lotNos: list(v) })} />
        <Slicer title="Invoice no" searchable tall value={filter.invoices ?? []}
          rows={available?.invoices ?? []}
          onChange={(v) => set({ invoices: list(v) })} />
        <Slicer title="Packing (kg)" searchable value={(filter.packings ?? []).map(String)}
          rows={available?.packings ?? []}
          onChange={(v) => set({ packings: v.length ? v.map(Number) : undefined })} />
        <Slicer title="Bags" searchable value={(filter.bags ?? []).map(String)}
          rows={available?.bags ?? []}
          onChange={(v) => set({ bags: v.length ? v.map(Number) : undefined })} />
        <Slicer title="Region (district code)" searchable value={filter.districts ?? []}
          rows={available?.districts ?? []}
          onChange={(v) => set({ districts: list(v) })} />
        <Slicer title="Sharing status" value={filter.sharingStatus ? [filter.sharingStatus] : []}
          rows={[{ key: "asc", label: "ASC sharing mark", lots: 0 }, { key: "other", label: "Other broker mark", lots: 0 }]}
          onChange={(v) => set({ sharingStatus: (v.at(-1) ?? null) as MslAnalyticsFilter["sharingStatus"] })} />
        <Slicer title="Bio / organic tea" value={filter.organic ? [filter.organic] : []}
          rows={[{ key: "organic", label: "Bio / organic tea", lots: 0 }, { key: "non", label: "Non organic tea", lots: 0 }]}
          onChange={(v) => set({ organic: (v.at(-1) ?? null) as MslAnalyticsFilter["organic"] })} />
        <InputBox title="Price range (Rs/kg)">
          <div className="flex gap-1.5">
            <TextField size="small" placeholder="Min" type="number" defaultValue={filter.priceMin ?? ""}
              onBlur={(e) => set({ priceMin: e.target.value ? Number(e.target.value) : null })}
              sx={{ "& .MuiInputBase-root": { fontSize: 12 } }} />
            <TextField size="small" placeholder="Max" type="number" defaultValue={filter.priceMax ?? ""}
              onBlur={(e) => set({ priceMax: e.target.value ? Number(e.target.value) : null })}
              sx={{ "& .MuiInputBase-root": { fontSize: 12 } }} />
          </div>
        </InputBox>
        <InputBox title="Mark search">
          <TextField size="small" placeholder="Starts with…" fullWidth defaultValue={filter.markSearch ?? ""}
            onBlur={(e) => set({ markSearch: e.target.value || null })}
            onKeyDown={(e) => e.key === "Enter" && set({ markSearch: (e.target as HTMLInputElement).value || null })}
            sx={{ "& .MuiInputBase-root": { fontSize: 12 } }} />
        </InputBox>
      </div>
    </div>
  );
}
