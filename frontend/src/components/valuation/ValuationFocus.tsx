"use client";

import { CLASSIFICATIONS } from "@/lib/classifications";
import { api } from "@/lib/api";
import {
  askingPriceOf,
  catalogueRemarkOf,
  catalogueStandardOf,
  hasValuation,
  markCodeOf,
  minimumLimitOf,
  noOfChestsOf,
  sellingMarkOf,
  valuationToText,
  weightPerChestOf,
} from "@/lib/lotDisplay";
import { parseValuationInput, sanitizeValuationInput, valuationTypingFeedback } from "@/lib/valuationInput";
import { STATUS_OPTIONS, type StatusFilter } from "@/lib/valuationFilters";
import type { ColumnFilterState, TicketStatus } from "@/lib/lotFilters";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import {
  effectiveOfParsed,
  effectiveValuationOf,
  formatTierRange,
  suggestTier,
  tierStatsFor,
  tierSummary,
} from "@/lib/previousSale";
import FilterPanel from "@/components/catalogue/FilterPanel";
import type { ClassificationValue, ColumnMeta, GradeStats, Lot, ValuationUpdate } from "@/types/api";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import BackspaceOutlinedIcon from "@mui/icons-material/BackspaceOutlined";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import FilterListIcon from "@mui/icons-material/FilterList";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import SearchIcon from "@mui/icons-material/Search";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState } from "react";

/** Filter state lifted from the Valuation Centre page — the focus view edits the very
 *  same filters the list uses (identical to Catalogue Manager's per-column engine),
 *  and navigation walks the filtered list. */
export interface FocusFilters {
  search: string;
  setSearch: (v: string) => void;
  statusFilter: StatusFilter;
  setStatusFilter: (v: StatusFilter) => void;
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  columnFilters: Record<string, ColumnFilterState>;
  onColumnFilterChange: (header: string, value: ColumnFilterState) => void;
  ticketStatus: TicketStatus | "";
  setTicketStatus: (v: TicketStatus | "") => void;
  classification: string;
  setClassification: (v: string) => void;
  /** Active column/ticket/classification filter count (excludes search + progress). */
  columnFilterCount: number;
  onClearAll: () => void;
  /** The lots currently matching every filter — shown as a tappable results strip. */
  matchLots: Lot[];
}

interface ValuationFocusProps {
  lot: Lot;
  /** Previous-sale classification history for this lot's grade — null when there is none. */
  gradeStats: GradeStats | null;
  /** 0-based position within the navigation list. */
  index: number;
  total: number;
  filters: FocusFilters;
  onNavigate: (index: number) => void;
  /** Jump straight to a lot picked from the filtered results strip. */
  onJump: (lotId: string) => void;
  onExit: () => void;
  /** Sync a saved lot back into the parent page's state. */
  onLotUpdated: (lot: Lot) => void;
}

const isClassified = (lot: Lot) => (lot.valuation?.classification ?? "Unclassified") !== "Unclassified";

type FocusTextField = "standardData" | "adjectiveData" | "brokerNotes" | "liquorRemarks";

// The four remark columns worked alongside the valuation, left to right; the
// calculator keypad takes the fifth (right-most) container.
const FOCUS_TEXT_FIELDS: { value: FocusTextField; label: string; placeholder: string }[] = [
  { value: "standardData", label: "Standard", placeholder: "e.g. Well made, even, blackish" },
  { value: "adjectiveData", label: "Adjectives", placeholder: "e.g. Bright, brisk, tippy" },
  { value: "brokerNotes", label: "Remarks", placeholder: "General remarks for this lot…" },
  { value: "liquorRemarks", label: "Liquor Remarks", placeholder: "Tasting notes on the liquor…" },
];

/** One fact cell in the lot-details box. */
function Fact({ label, value, strong }: { label: string; value: string | null | undefined; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9.5px] tracking-widest uppercase text-text-muted mb-0.5">{label}</div>
      <div
        className={`text-[13px] leading-snug break-words ${strong ? "font-semibold text-text-strong" : "text-text"}`}
      >
        {value?.trim() ? value : "—"}
      </div>
    </div>
  );
}

const KEYPAD_ROWS: string[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  ["-", "0", "⌫"],
];

export default function ValuationFocus({
  lot,
  gradeStats,
  index,
  total,
  filters,
  onNavigate,
  onJump,
  onExit,
  onLotUpdated,
}: ValuationFocusProps) {
  const [text, setText] = useState(() => valuationToText(lot));
  const [fieldText, setFieldText] = useState<Record<FocusTextField, string>>(() => seedFields(lot));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clsNeeded, setClsNeeded] = useState(false);
  // Current classification was auto-picked from the previous sale (labels the hint line).
  const [autoCls, setAutoCls] = useState(false);
  // Auto-classification ran but this grade has no previous-sale history.
  const [noPrevData, setNoPrevData] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function seedFields(l: Lot): Record<FocusTextField, string> {
    return {
      standardData: l.valuation?.standardData ?? "",
      adjectiveData: l.valuation?.adjectiveData ?? "",
      brokerNotes: l.valuation?.brokerNotes ?? "",
      liquorRemarks: l.valuation?.liquorRemarks ?? "",
    };
  }

  // Re-seed the entry fields whenever a different lot comes into focus.
  const lotId = lot.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(valuationToText(lot));
    setFieldText(seedFields(lot));
    setError(null);
    setClsNeeded(false);
    setAutoCls(false);
    setNoPrevData(false);
    // Give the keypad input focus — but never steal it while the user is typing in
    // another field (the search bar / a filter / a remark box), or searching would be
    // interrupted the moment the first match changes the focused lot.
    const active = document.activeElement;
    const typingElsewhere =
      active instanceof HTMLElement &&
      active !== inputRef.current &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.getAttribute("role") === "combobox");
    if (!typingElsewhere) inputRef.current?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lotId]);

  // Full-screen: freeze the page behind the overlay while focus mode is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  const v = lot.valuation;
  const currentCls = v?.classification ?? "Unclassified";
  const saved = hasValuation(lot);
  const complete = saved && isClassified(lot);
  const valuationDirty = text !== valuationToText(lot);
  const fieldDirty = (f: FocusTextField) => fieldText[f].trim() !== (v?.[f] ?? "").trim();
  const feedback = !error && valuationDirty ? valuationTypingFeedback(text) : null;
  // While the typed value is valid and the tier isn't hand-picked, the previous sale's
  // suggestion previews as selected — it's saved together with the value.
  const liveParsed = valuationDirty ? parseValuationInput(text) : null;
  const liveValue = liveParsed ? effectiveOfParsed(liveParsed) : null;
  const mayAuto = currentCls === "Unclassified" || autoCls;
  const liveTier = mayAuto && liveValue !== null && gradeStats ? suggestTier(gradeStats, liveValue) : null;
  const displayCls = liveTier ?? currentCls;

  // All text paths (typing, paste, keypad) funnel through here — the sanitizer keeps
  // the field to digits and a single range dash no matter how input arrives.
  const edit = (updater: (prev: string) => string) => {
    setError(null);
    setText((prev) => sanitizeValuationInput(updater(prev)));
  };

  const pressKey = (key: string) => {
    if (key === "⌫") edit((t) => t.slice(0, -1));
    else edit((t) => t + key);
    inputRef.current?.focus();
  };

  /**
   * Save everything that changed (valuation text + any dirty remark fields, plus an
   * optional extra patch like classification) in one API call. Returns the up-to-date
   * lot, or null on invalid valuation input / failed save — callers stay put on null.
   */
  const saveAll = async (extra?: Partial<ValuationUpdate>): Promise<Lot | null> => {
    const patch: Partial<ValuationUpdate> = { ...extra };
    // null = the auto flag is untouched by this save; true/false = set/cleared.
    let autoApplied: boolean | null = null;
    if (valuationDirty) {
      const parsed = parseValuationInput(text);
      if (parsed.kind === "error") {
        setError(parsed.message);
        return null;
      }
      if (parsed.kind === "clear") {
        patch.valuationSingle = null;
        patch.valuationFrom = null;
        patch.valuationTo = null;
      } else if (parsed.kind === "single") {
        patch.valuationSingle = parsed.value;
        patch.valuationFrom = null;
        patch.valuationTo = null;
      } else {
        patch.valuationSingle = null;
        patch.valuationFrom = parsed.from;
        patch.valuationTo = parsed.to;
      }
      // Live auto-classification rides along with a new value while the tier is unset
      // or was itself auto-picked — an explicit tier in `extra` (a tap) always wins,
      // and a hand-picked tier is never touched.
      if (patch.classification === undefined && (currentCls === "Unclassified" || autoCls)) {
        const liveValue = effectiveOfParsed(parsed);
        const tier = gradeStats && liveValue !== null ? suggestTier(gradeStats, liveValue) : null;
        if (tier) {
          patch.classification = tier;
          autoApplied = true;
        } else if (parsed.kind === "clear" && autoCls) {
          // The value is gone — the auto-picked tier goes with it.
          patch.classification = "Unclassified";
          autoApplied = false;
        }
      }
    }
    FOCUS_TEXT_FIELDS.forEach((f) => {
      if (fieldDirty(f.value)) {
        const trimmed = fieldText[f.value].trim();
        patch[f.value] = trimmed === "" ? null : trimmed;
      }
    });
    if (Object.keys(patch).length === 0) return lot;

    setSaving(true);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
      onLotUpdated(updated);
      setError(null);
      if (autoApplied !== null) setAutoCls(autoApplied);
      return updated;
    } catch {
      setError("Save failed — try again");
      return null;
    } finally {
      setSaving(false);
    }
  };

  // Auto-pick a classification from the previous sale's record for this grade.
  // Returns the updated lot, or null when there's no usable history / the save failed.
  const autoClassify = async (l: Lot): Promise<Lot | null> => {
    const value = effectiveValuationOf(l);
    const tier = gradeStats && value !== null ? suggestTier(gradeStats, value) : null;
    if (!tier) {
      setNoPrevData(true);
      return null;
    }
    setSaving(true);
    try {
      const updated = await api.updateValuation(l.id, buildValuationUpdate(l, { classification: tier }));
      onLotUpdated(updated);
      setAutoCls(true);
      return updated;
    } catch {
      setError("Save failed — try again");
      return null;
    } finally {
      setSaving(false);
    }
  };

  /** Save, then move on — unless the classification gate holds this lot in place. */
  const saveAndNext = async () => {
    const updated = await saveAll();
    if (!updated) return;
    if (hasValuation(updated) && !isClassified(updated)) {
      // Try the previous sale's suggestion first. Either way stay on this lot so the
      // tier can be reviewed or overridden — Save & Next again moves on.
      const auto = await autoClassify(updated);
      if (!auto) setClsNeeded(true);
      return;
    }
    if (index + 1 < total) onNavigate(index + 1);
  };

  const goTo = async (target: number) => {
    // Carry any typed values out with us, same as the grid's arrow-key navigation.
    const updated = await saveAll();
    if (!updated) return;
    if (target < 0 || target >= total) return;
    onNavigate(target);
  };

  // Jump straight to a lot tapped in the filtered results strip, saving first.
  const jumpTo = async (id: string) => {
    if (id === lot.id) return;
    const updated = await saveAll();
    if (!updated) return;
    onJump(id);
  };

  // Tapping a tier saves it but stays on this lot — moving on is always an explicit
  // Save & Next / Enter / arrow, so the tier can be reconsidered before leaving.
  const commitClassification = async (value: ClassificationValue) => {
    const next: ClassificationValue = currentCls === value ? "Unclassified" : value;
    const updated = await saveAll({ classification: next });
    if (!updated) return;
    // A hand-picked tier is an override — drop the auto-selected label and no-data note.
    setAutoCls(false);
    setNoPrevData(false);
    if (next !== "Unclassified") setClsNeeded(false);
  };

  const facts: { label: string; value: string | null | undefined; strong?: boolean }[] = [
    { label: "Lot No", value: lot.lotNumber, strong: true },
    { label: "Selling Mark", value: sellingMarkOf(lot), strong: true },
    { label: "Mark Code", value: markCodeOf(lot) ?? lot.mark },
    { label: "Grade", value: lot.grade, strong: true },
    { label: "Chests", value: noOfChestsOf(lot) },
    { label: "Wt / Chest (kg)", value: weightPerChestOf(lot) },
    { label: "Standard", value: v?.standardData ?? catalogueStandardOf(lot) },
    { label: "Remark", value: catalogueRemarkOf(lot) ?? v?.adjectiveData },
    { label: "Liquor Remarks", value: v?.liquorRemarks },
    { label: "Valuation", value: valuationToText(lot) || null, strong: true },
    { label: "Asking", value: askingPriceOf(lot) },
    { label: "Minimum Limit", value: minimumLimitOf(lot) },
  ];

  const filtersActive =
    filters.search.trim() !== "" || filters.statusFilter !== "all" || filters.columnFilterCount > 0;

  return (
    <div
      className="fixed inset-0 z-[60] flex flex-col"
      style={{ background: "var(--surface-alt)" }}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onExit();
        } else if (e.key === "PageUp" || (e.key === "ArrowUp" && e.target === inputRef.current)) {
          e.preventDefault();
          goTo(index - 1);
        } else if (e.key === "PageDown" || (e.key === "ArrowDown" && e.target === inputRef.current)) {
          e.preventDefault();
          goTo(index + 1);
        }
      }}
    >
      {/* ---- top bar: exit, universal search, filters, position ---- */}
      <div
        className="flex items-center gap-2 flex-wrap px-3 md:px-5 py-2.5 border-b border-border shrink-0"
        style={{ background: "var(--surface)" }}
      >
        <Button size="small" startIcon={<ArrowBackIcon fontSize="small" />} onClick={onExit} sx={{ fontWeight: 600 }}>
          All lots
        </Button>
        <TextField
          size="small"
          placeholder="Search any lot data — lot no, mark, grade, any column…"
          value={filters.search}
          onChange={(e) => filters.setSearch(e.target.value)}
          sx={{ flex: 1, minWidth: 220 }}
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Select
          size="small"
          value={filters.statusFilter}
          onChange={(e) => filters.setStatusFilter(e.target.value as StatusFilter)}
          sx={{ minWidth: 170, fontSize: 13 }}
        >
          {STATUS_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
        <Button
          size="small"
          variant={filtersOpen ? "contained" : "outlined"}
          startIcon={<FilterListIcon fontSize="small" />}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filters{filters.columnFilterCount > 0 ? ` (${filters.columnFilterCount})` : ""}
        </Button>
        {filtersActive && (
          <Button
            size="small"
            onClick={() => {
              filters.onClearAll();
              setFiltersOpen(false);
            }}
          >
            Clear
          </Button>
        )}
        <span className="text-[12px] text-text-muted font-mono whitespace-nowrap ml-auto">
          {filtersActive
            ? `${filters.matchLots.length.toLocaleString()} match${filters.matchLots.length === 1 ? "" : "es"} · `
            : ""}
          Lot {index + 1} / {total}
        </span>
        <div className="flex items-center gap-1">
          <IconButton
            size="small"
            disabled={index === 0 || saving}
            onClick={() => goTo(index - 1)}
            aria-label="Previous lot"
          >
            <ChevronLeftIcon />
          </IconButton>
          <IconButton
            size="small"
            disabled={index + 1 >= total || saving}
            onClick={() => goTo(index + 1)}
            aria-label="Next lot"
          >
            <ChevronRightIcon />
          </IconButton>
        </div>
      </div>

      {/* ---- collapsible per-column filter panel (same engine as Catalogue Manager) ---- */}
      {filtersOpen && (
        <div
          className="max-h-[42vh] overflow-y-auto px-3 md:px-5 pt-3 border-b border-border shrink-0"
          style={{ background: "var(--surface)" }}
        >
          <FilterPanel
            headers={filters.headers}
            columnMeta={filters.columnMeta}
            columnFilters={filters.columnFilters}
            onColumnFilterChange={filters.onColumnFilterChange}
            status={filters.ticketStatus}
            onStatusChange={filters.setTicketStatus}
            classification={filters.classification}
            onClassificationChange={filters.setClassification}
            onClearAll={filters.onClearAll}
          />
        </div>
      )}

      {/* ---- filtered results strip: the matching rows, tap one to open it ---- */}
      {filtersActive && (
        <div
          className="flex items-center gap-1.5 px-3 md:px-5 py-2 border-b border-border overflow-x-auto shrink-0"
          style={{ background: "var(--surface-sunken)" }}
        >
          {filters.matchLots.length === 0 && (
            <span className="text-[12px] text-text-muted whitespace-nowrap">
              No lots match these filters — adjust or clear them above.
            </span>
          )}
          {filters.matchLots.slice(0, 100).map((l) => {
            const isCurrent = l.id === lot.id;
            const done = hasValuation(l) && isClassified(l);
            return (
              <button
                key={l.id}
                type="button"
                onClick={() => jumpTo(l.id)}
                title={[l.lotNumber && `Lot ${l.lotNumber}`, sellingMarkOf(l), l.grade].filter(Boolean).join(" · ")}
                className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[11.5px] font-semibold whitespace-nowrap cursor-pointer touch-manipulation shrink-0"
                style={{
                  borderColor: isCurrent ? "var(--liquor)" : "var(--border)",
                  background: isCurrent ? "var(--liquor)" : "var(--surface)",
                  color: isCurrent ? "var(--paper-0)" : "var(--text)",
                }}
              >
                {done && (
                  <CheckCircleIcon sx={{ fontSize: 13, color: isCurrent ? "var(--paper-0)" : "var(--sage)" }} />
                )}
                {l.lotNumber ?? l.rowKey}
                {sellingMarkOf(l) && (
                  <span style={{ opacity: 0.75, fontWeight: 500 }}>{sellingMarkOf(l)}</span>
                )}
                {l.grade && <span style={{ opacity: 0.75, fontWeight: 500 }}>{l.grade}</span>}
              </button>
            );
          })}
          {filters.matchLots.length > 100 && (
            <span className="text-[11.5px] text-text-muted whitespace-nowrap">
              +{(filters.matchLots.length - 100).toLocaleString()} more — narrow the filters
            </span>
          )}
        </div>
      )}

      {/* ---- scrollable work area ---- */}
      <div className="flex-1 overflow-y-auto">
        <div className="max-w-[1500px] mx-auto px-3 md:px-5 py-4">
          {/* lot details box */}
          <Paper variant="outlined" sx={{ borderColor: "var(--border)", mb: 2 }}>
            <div
              className="px-4 py-2 border-b border-border flex items-center gap-2"
              style={{ background: "var(--surface-sunken)" }}
            >
              <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">Lot Details</span>
              <span className="ml-auto flex items-center gap-1.5 text-[11.5px] font-semibold">
                {complete ? (
                  <>
                    <CheckCircleIcon sx={{ fontSize: 15, color: "var(--sage)" }} />
                    <span style={{ color: "var(--sage-dark)" }}>Valued &amp; classified</span>
                  </>
                ) : saved ? (
                  <>
                    <RadioButtonUncheckedIcon sx={{ fontSize: 15, color: "var(--warn)" }} />
                    <span style={{ color: "var(--warn)" }}>Classification pending</span>
                  </>
                ) : (
                  <>
                    <RadioButtonUncheckedIcon sx={{ fontSize: 15, color: "var(--text-muted)" }} />
                    <span className="text-text-muted">Not valued yet</span>
                  </>
                )}
              </span>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-5 gap-y-3.5 px-4 py-3.5">
              {facts.map((f) => (
                <Fact key={f.label} {...f} />
              ))}
            </div>
          </Paper>

          {/* classification tiers */}
          <div
            className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-1 rounded-xl"
            style={clsNeeded ? { outline: "2px solid var(--warn)", outlineOffset: 3 } : undefined}
          >
            {CLASSIFICATIONS.map((c) => {
              const active = displayCls === c.value;
              const tierInfo = tierStatsFor(gradeStats, c.value);
              return (
                <button
                  key={c.value}
                  type="button"
                  disabled={saving}
                  onClick={() => commitClassification(c.value)}
                  title={active ? "Tap again to unset" : `Mark as ${c.label}`}
                  className="min-h-[52px] rounded-lg border-2 cursor-pointer touch-manipulation active:scale-[0.98] transition-transform py-1.5"
                  style={{
                    borderColor: c.color,
                    background: active ? c.color : "var(--surface)",
                    color: active ? "var(--paper-0)" : c.color,
                  }}
                >
                  <span className="block text-[15px] font-bold leading-tight">
                    {active ? "✓ " : ""}
                    {c.label}
                  </span>
                  {/* This tier's record for the lot's grade in the previous sale. */}
                  {gradeStats && (
                    <span className="block text-[10.5px] font-semibold mt-0.5" style={{ opacity: 0.85 }}>
                      {tierInfo
                        ? `${formatTierRange(tierInfo)} · ${Math.round(tierInfo.percent)}%`
                        : "no lots last sale"}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="min-h-[20px] mb-1.5">
            {liveTier && gradeStats && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--sage-dark)" }}>
                Auto-selects on save · {tierSummary(lot.grade, gradeStats, liveTier)} — tap another tier to override
              </span>
            )}
            {!liveTier && autoCls && gradeStats && currentCls !== "Unclassified" && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--sage-dark)" }}>
                Auto-selected · {tierSummary(lot.grade, gradeStats, currentCls)} — tap another tier to override
              </span>
            )}
            {mayAuto && liveValue !== null && !gradeStats && (
              <span className="text-[11.5px] font-semibold text-text-muted">
                No previous-sale data for {lot.grade ?? "this grade"} — tap a tier manually
              </span>
            )}
            {clsNeeded && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--warn)" }}>
                {noPrevData ? `No previous-sale data for ${lot.grade ?? "this grade"} — ` : "Classification required — "}
                tap a tier, then Save &amp; Next to move on
              </span>
            )}
          </div>

          {/* entry columns: four remark containers + the calculator on the far right */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3 items-stretch pb-4">
            {FOCUS_TEXT_FIELDS.map((f) => (
              <Paper
                key={f.value}
                variant="outlined"
                sx={{ borderColor: "var(--border)", p: 1.5, display: "flex", flexDirection: "column" }}
              >
                <div className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-1.5">
                  {f.label}
                </div>
                <textarea
                  value={fieldText[f.value]}
                  placeholder={f.placeholder}
                  disabled={saving}
                  onChange={(e) => setFieldText((prev) => ({ ...prev, [f.value]: e.target.value }))}
                  onBlur={() => {
                    if (fieldDirty(f.value)) saveAll();
                  }}
                  className="flex-1 w-full resize-none bg-transparent border border-border rounded-md px-2.5 py-2 text-[13px] leading-relaxed outline-none min-h-[150px] xl:min-h-0"
                  style={{ color: "var(--text)" }}
                />
              </Paper>
            ))}

            {/* calculator container — most right */}
            <Paper variant="outlined" sx={{ borderColor: "var(--brass)", p: 1.5, display: "flex", flexDirection: "column" }}>
              <div className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-1.5">
                Valuation (LKR) — 1250 or 1200-1350
              </div>
              <div className="flex items-center gap-1.5 mb-1">
                <span className="text-[12px] text-text-muted font-mono shrink-0">Rs.</span>
                <input
                  ref={inputRef}
                  type="text"
                  inputMode="none"
                  autoFocus
                  placeholder="Keypad or type"
                  className="w-full min-w-0 px-2.5 py-2 rounded-lg border-2 text-[20px] font-mono font-semibold bg-transparent tracking-wide"
                  style={{ borderColor: error ? "var(--danger)" : "var(--brass)", color: "var(--text-strong)" }}
                  value={text}
                  disabled={saving}
                  onChange={(e) => edit(() => e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveAndNext();
                    }
                  }}
                />
              </div>
              <div className="min-h-[16px] mb-1.5">
                {error && <span className="text-[11px] text-danger">{error}</span>}
                {!error && feedback && feedback.tone !== "none" && (
                  <span
                    className="text-[11px]"
                    style={{ color: feedback.tone === "ok" ? "var(--sage-dark)" : "var(--text-muted)" }}
                  >
                    {feedback.tone === "ok" ? "✓ " : ""}
                    {feedback.message}
                  </span>
                )}
              </div>

              <div className="grid grid-cols-3 gap-1.5 select-none flex-1">
                {KEYPAD_ROWS.flat().map((key) => (
                  <button
                    key={key}
                    type="button"
                    disabled={saving}
                    onClick={() => pressKey(key)}
                    aria-label={key === "⌫" ? "Backspace" : key === "-" ? "Range dash" : key}
                    className="min-h-[48px] rounded-lg border text-[19px] font-semibold font-mono cursor-pointer touch-manipulation active:scale-[0.97] transition-transform"
                    style={{
                      borderColor: "var(--border)",
                      background: "var(--surface-alt)",
                      color: key === "⌫" ? "var(--danger)" : "var(--text-strong)",
                    }}
                  >
                    {key === "⌫" ? <BackspaceOutlinedIcon sx={{ fontSize: 20, verticalAlign: "middle" }} /> : key}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    edit(() => "");
                    inputRef.current?.focus();
                  }}
                  className="min-h-[48px] rounded-lg border text-[13px] font-semibold cursor-pointer touch-manipulation active:scale-[0.97] transition-transform"
                  style={{ borderColor: "var(--border)", background: "var(--surface-alt)", color: "var(--text-muted)" }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveAndNext}
                  className="min-h-[48px] col-span-2 rounded-lg text-[14px] font-bold cursor-pointer touch-manipulation active:scale-[0.97] transition-transform"
                  style={{ background: "var(--liquor)", color: "var(--paper-0)" }}
                >
                  {saving ? "Saving…" : "Save & Next ⏎"}
                </button>
              </div>
            </Paper>
          </div>
        </div>
      </div>
    </div>
  );
}
