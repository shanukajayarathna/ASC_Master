"use client";

import type { ChatScope } from "@/types/api";
import DateRangeOutlinedIcon from "@mui/icons-material/DateRangeOutlined";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Popover from "@mui/material/Popover";
import Select from "@mui/material/Select";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useEffect, useState } from "react";
import { describeScope, scopeProblem, useArchiveSales, useCatalogueSales, type ArchiveSale } from "./scope";

type Mode = "all" | "sale" | "range" | "year";

const MODES: { key: Mode; label: string }[] = [
  { key: "all", label: "All sales" },
  { key: "sale", label: "One sale" },
  { key: "range", label: "Range" },
  { key: "year", label: "Year(s)" },
];

const label = (s: ArchiveSale) => `${String(s.saleNo).padStart(2, "0")}/${s.year}`;
const keyOf = (s: ArchiveSale) => `${s.year}-${s.saleNo}`;

function modeOf(scope: ChatScope | null): Mode {
  if (!scope) return "all";
  if (scope.fromSale == null && scope.toSale == null) return "year";
  return scope.fromSale === scope.toSale && scope.fromYear === scope.toYear ? "sale" : "range";
}

interface ScopeControlProps {
  scope: ChatScope | null;
  onChange: (scope: ChatScope | null) => void;
}

/**
 * Chooses MSL archive results or sale catalogue records (OKLO and imported files), then a single sale, range, or year set.
 */
export default function ScopeControl({ scope, onChange }: ScopeControlProps) {
  const archiveSales = useArchiveSales();
  const catalogueSales = useCatalogueSales();
  const [source, setSource] = useState<"msl" | "catalogue" | "both">(scope?.source ?? "catalogue");
  const bothSales = [...archiveSales, ...catalogueSales]
    .reduce<ArchiveSale[]>((all, sale) => {
      const index = all.findIndex((item) => item.year === sale.year && item.saleNo === sale.saleNo);
      if (index < 0) all.push(sale);
      else if (sale.catalogueId) all[index] = sale;
      return all;
    }, [])
    .sort((a, b) => b.year - a.year || b.saleNo - a.saleNo);
  const sales = source === "msl" ? archiveSales : source === "both" ? bothSales : catalogueSales;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [draft, setDraft] = useState<{ mode: Mode; from: string; to: string }>({ mode: "all", from: "", to: "" });

  const years = [...new Set(sales.map((s) => s.year))];
  useEffect(() => {
    if (archiveSales.length === 0 || scope?.userSelected) return;
    const latest = archiveSales[0];
    if (scope?.source === "msl" && scope.fromYear === latest.year && scope.fromSale === latest.saleNo && scope.toYear === latest.year && scope.toSale === latest.saleNo) return;
    onChange({ source: "msl", fromYear: latest.year, fromSale: latest.saleNo, toYear: latest.year, toSale: latest.saleNo, userSelected: false });
  }, [archiveSales, scope, onChange]);
  const open = (el: HTMLElement) => {
    const from = scope ? `${scope.fromYear}-${scope.fromSale ?? ""}` : "";
    const to = scope ? `${scope.toYear}-${scope.toSale ?? ""}` : "";
    const nextSource = scope?.source ?? "catalogue";
    setSource(nextSource);
    setDraft({ mode: modeOf(scope), from, to });
    setAnchor(el);
  };

  const parse = (v: string): { year: number; sale: number | null } | null => {
    if (!v) return null;
    const [y, s] = v.split("-");
    return { year: Number(y), sale: s ? Number(s) : null };
  };

  /** The scope the draft describes, or null when it is not complete yet. */
  const built = (): ChatScope | null | undefined => {
    if (draft.mode === "all") {
      if (source === "msl") return null;
      if (!sales.length) return undefined;
      const years = sales.map((s) => s.year);
      return { source, fromYear: Math.min(...years), fromSale: null, toYear: Math.max(...years), toSale: null };
    }
    const from = parse(draft.from);
    const to = draft.mode === "range" || draft.mode === "year" ? parse(draft.to) : from;
    if (!from || !to) return undefined;
    return draft.mode === "year"
      ? { source, fromYear: from.year, toYear: to.year, fromSale: null, toSale: null }
      : { source, fromYear: from.year, fromSale: from.sale, toYear: to.year, toSale: to.sale };
  };
  const next = built();
  const problem = next ? scopeProblem(next) : null;
  const apply = () => {
    if (next === undefined || problem) return;
    onChange(next ? { ...next, userSelected: true } : null);
    setAnchor(null);
  };

  return (
    <>
      <Button
        size="small"
        variant={scope ? "contained" : "outlined"}
        startIcon={<DateRangeOutlinedIcon fontSize="small" />}
        onClick={(e) => open(e.currentTarget)}
        aria-haspopup="dialog"
        aria-expanded={anchor !== null}
        aria-label={`Scope: ${describeScope(scope)}. Change`}
        sx={{ minHeight: 40, textTransform: "none" }}
      >
        {describeScope(scope)}
      </Button>
      <Popover open={anchor !== null} anchorEl={anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "top", horizontal: "left" }} transformOrigin={{ vertical: "bottom", horizontal: "left" }}>
        <div className="ws-scope" role="dialog" aria-label="Scope">
          <p className="ws-scope-intro">Choose the data source and sale period</p>
          <label className="ws-scope-field"><span>Data source</span><Select size="small" value={source} onChange={(e) => { const v = e.target.value as "msl" | "catalogue" | "both"; setSource(v); setDraft({ mode: "all", from: "", to: "" }); }} inputProps={{ "aria-label": "Data source" }} sx={{ minWidth: 220 }}>
            <MenuItem value="msl">MSL archive results</MenuItem><MenuItem value="catalogue">Sale catalogues (OKLO / imported files)</MenuItem><MenuItem value="both">Both data sources</MenuItem>
          </Select></label>
          <ToggleButtonGroup exclusive size="small" value={draft.mode} onChange={(_, m: Mode | null) => m && setDraft((d) => ({ ...d, mode: m, ...(m === "all" ? { from: "", to: "" } : {}) }))} aria-label="Scope type" sx={{ flexWrap: "wrap" }}>
            {MODES.map((m) => (
              <ToggleButton key={m.key} value={m.key} sx={{ textTransform: "none", minHeight: 40, minWidth: 44, px: 1.5 }}>
                {m.label}
              </ToggleButton>
            ))}
          </ToggleButtonGroup>

          {draft.mode === "sale" && (
            <SalePick label="Sale" value={draft.from} sales={sales} onChange={(v) => setDraft((d) => ({ ...d, from: v, to: v }))} />
          )}
          {draft.mode === "range" && (
            <>
              <SalePick label="From sale" value={draft.from} sales={[...sales].reverse()} onChange={(v) => setDraft((d) => ({ ...d, from: v }))} />
              <SalePick label="To sale" value={draft.to} sales={sales} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
            </>
          )}
          {draft.mode === "year" && (
            <>
              <YearPick label="From year" value={draft.from} years={[...years].reverse()} onChange={(v) => setDraft((d) => ({ ...d, from: v, to: d.to || v }))} />
              <YearPick label="To year" value={draft.to} years={years} onChange={(v) => setDraft((d) => ({ ...d, to: v }))} />
            </>
          )}

          <p className="ws-scope-note">
            {draft.mode === "all"
              ? source === "msl" ? "Nothing is limited: the assistant picks the period that fits each archive question." : source === "catalogue" ? "Includes every sale currently available in OKLO or imported sale files." : "Includes matching MSL results and sale catalogue records."
              : source === "msl" ? "Uses settled results stored in the MSL archive." : source === "catalogue" ? "Uses the selected sale catalogue records from OKLO or imported/downloaded files." : "Combines MSL archive results with matching OKLO/imported sale records."}
          </p>
          {problem && <p className="ws-lots-note ws-lots-error" role="alert">{problem}</p>}
          <div className="ws-scope-actions">
            <Button size="small" onClick={() => setAnchor(null)} sx={{ minHeight: 40 }}>Cancel</Button>
            <Button size="small" variant="contained" disabled={next === undefined || problem !== null} onClick={apply} sx={{ minHeight: 40 }}>
              Apply
            </Button>
          </div>
        </div>
      </Popover>
    </>
  );
}

function SalePick({ label: text, value, sales, onChange }: { label: string; value: string; sales: ArchiveSale[]; onChange: (v: string) => void }) {
  return (
    <label className="ws-scope-field">
      <span>{text}</span>
      <Select size="small" value={value} displayEmpty onChange={(e) => onChange(e.target.value)} inputProps={{ "aria-label": text }} sx={{ minWidth: 160 }} MenuProps={{ slotProps: { paper: { sx: { maxHeight: 320 } } } }}>
        <MenuItem value="" disabled>Choose…</MenuItem>
        {sales.map((s) => (
          <MenuItem key={keyOf(s)} value={keyOf(s)} sx={{ minHeight: 40 }}>
            Sale {label(s)}
          </MenuItem>
        ))}
      </Select>
    </label>
  );
}

function YearPick({ label: text, value, years, onChange }: { label: string; value: string; years: number[]; onChange: (v: string) => void }) {
  return (
    <label className="ws-scope-field">
      <span>{text}</span>
      <Select size="small" value={value} displayEmpty onChange={(e) => onChange(e.target.value)} inputProps={{ "aria-label": text }} sx={{ minWidth: 160 }}>
        <MenuItem value="" disabled>Choose…</MenuItem>
        {years.map((y) => (
          <MenuItem key={y} value={`${y}-`} sx={{ minHeight: 40 }}>
            {y}
          </MenuItem>
        ))}
      </Select>
    </label>
  );
}
