"use client";

import { CLASSIFICATIONS } from "@/lib/classifications";
import { api, type LotMedia } from "@/lib/api";
import LotPhoto from "@/components/valuation/LotPhoto";
import VoiceRecorder from "@/components/valuation/VoiceRecorder";
import {
  askingPriceOf,
  catalogueRemarkOf,
  catalogueStandardOf,
  hasValuation,
  markCodeOf,
  minimumLimitOf,
  noOfChestsOf,
  sellingMarkOf,
  valuationPairOf,
  valuationToText,
  weightPerChestOf,
} from "@/lib/lotDisplay";
import { OUR_BROKER } from "@/lib/ourBroker";
import { buildSharingIndex, sharingsFor } from "@/lib/sharings";
import {
  parseValuationPair,
  sanitizeValuationSide,
  valuationPairFeedback,
  VALUATION_MAX_DIGITS,
} from "@/lib/valuationInput";
import { STATUS_OPTIONS, type StatusFilter } from "@/lib/valuationFilters";
import type { ColumnFilterState, TicketStatus } from "@/lib/lotFilters";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import { toggleKeyword } from "@/lib/remarkKeywords";
import KeywordChips from "@/components/valuation/KeywordChips";
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
import CompareArrowsIcon from "@mui/icons-material/CompareArrows";
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
import { useEffect, useMemo, useRef, useState } from "react";

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
  /** The working set the filters act on — FilterPanel derives its dropdown options from these. */
  lots: Lot[];
  columnFilters: Record<string, ColumnFilterState>;
  onColumnFilterChange: (header: string, value: ColumnFilterState) => void;
  ticketStatus: TicketStatus | "";
  setTicketStatus: (v: TicketStatus | "") => void;
  classification: string;
  setClassification: (v: string) => void;
  year: string;
  setYear: (v: string) => void;
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

/** A short, human "Lot 3 · ROBGILL · BOP" label — names the lot in the Back button. */
function shortLotLabel(l: Lot): string {
  return [l.lotNumber ? `Lot ${l.lotNumber}` : null, sellingMarkOf(l), l.grade].filter(Boolean).join(" · ") || l.rowKey;
}

type FocusTextField = "standardData" | "adjectiveData" | "brokerNotes" | "liquorRemarks";

// The four remark columns worked alongside the valuation, left to right; the
// calculator keypad takes the fifth (right-most) container.
const FOCUS_TEXT_FIELDS: { value: FocusTextField; label: string; placeholder: string }[] = [
  { value: "standardData", label: "Standard", placeholder: "Tap a term above, or type your own…" },
  { value: "adjectiveData", label: "Adjectives", placeholder: "Tap a term above, or type your own…" },
  { value: "brokerNotes", label: "Remarks", placeholder: "Tap a term above, or type your own…" },
  { value: "liquorRemarks", label: "Liquor Remarks", placeholder: "Tap a term above, or type your own…" },
];

/** One fact cell in the lot-details box. */
function Fact({ label, value, strong }: { label: string; value: string | null | undefined; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[9.5px] tracking-widest uppercase text-text-muted mb-0.5 truncate" title={label}>
        {label}
      </div>
      <div
        className={`text-[13px] leading-snug break-words ${strong ? "font-semibold text-text-strong" : "text-text"}`}
        // Long remark-style values clamp to two lines (full text on the tooltip) so the
        // details box stays a fixed, compact height and the buttons below stay reachable.
        style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}
        title={value?.trim() || undefined}
      >
        {value?.trim() ? value : "—"}
      </div>
    </div>
  );
}

// Fixed height for every card in the entry row (4 remark boxes + calculator) — a fixed
// pixel value rather than relying on CSS grid row-stretch, which only equalizes heights
// within the same grid row and falls apart the moment the responsive column count
// changes how the 5 cards wrap into rows (e.g. tablet widths at 2 columns).
// (Raised from 420 when the calculator gained its second entry line — the keypad's five
// 48px rows must still fit under both lines without the card clipping them.)
const FOCUS_CARD_HEIGHT = 460;
// Fixed (not just capped) height for the keyword-card row — every field gets the exact
// same amount of space here regardless of how many terms it lists, so the remaining space
// handed to the textarea below is identical across all four boxes too.
const FOCUS_CHIPS_HEIGHT = 170;

/** The two lines of the calculator: the value itself, and the optional upper end of a range. */
type ValuationLine = "from" | "to";

const VALUATION_LINES: { line: ValuationLine; prefix: string; label: string; placeholder: string }[] = [
  { line: "from", prefix: "Rs.", label: "Valuation", placeholder: "e.g. 1250" },
  { line: "to", prefix: "to", label: "Range upper value", placeholder: "only for a range" },
];

// The bottom-left key jumps to the second line instead of typing a range dash — on a
// tablet, tapping "Range" and using the same keypad beats hunting for a "-" separator.
const RANGE_KEY = "Range";

const KEYPAD_ROWS: string[][] = [
  ["7", "8", "9"],
  ["4", "5", "6"],
  ["1", "2", "3"],
  [RANGE_KEY, "0", "⌫"],
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
  // The valuation as the two entry lines hold it — `to` stays empty for a single value.
  const [pair, setPair] = useState(() => valuationPairOf(lot));
  // Which line the keypad types into.
  const [activeLine, setActiveLine] = useState<ValuationLine>("from");
  const [fieldText, setFieldText] = useState<Record<FocusTextField, string>>(() => seedFields(lot));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clsNeeded, setClsNeeded] = useState(false);
  // Current classification was auto-picked from the previous sale (labels the hint line).
  const [autoCls, setAutoCls] = useState(false);
  // Auto-classification ran but this grade has no previous-sale history.
  const [noPrevData, setNoPrevData] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // "Sharings" comparison panel — other brokers' lots of this same mark + grade.
  const [sharingsOpen, setSharingsOpen] = useState(false);
  // The lot you left when you tapped a sharing — drives the one-tap "Back to your lot"
  // banner so you can value a shared lot and return without hunting for where you were.
  const [returnAnchor, setReturnAnchor] = useState<{ id: string; label: string } | null>(null);
  const lineRefs = useRef<Record<ValuationLine, HTMLInputElement | null>>({ from: null, to: null });

  // Index the whole sale by mark+grade once, then pull this lot's sharings from it. The
  // working set (filters.lots) is every lot in the sale, so the comparison spans all brokers.
  const sharingIndex = useMemo(() => buildSharingIndex(filters.lots), [filters.lots]);
  // A sharing is another broker's lot of this same mark + grade — our own lots (and this
  // lot itself) are left out, so the panel shows only who else is offering it.
  const sharings = useMemo(
    () => sharingsFor(sharingIndex, lot).filter((l) => l.broker !== OUR_BROKER),
    [sharingIndex, lot]
  );

  // Per-lot media (photo + per-field voice notes), loaded once per lot. `mediaVersion` busts
  // the <img>/<audio> cache after a photo/voice is replaced or deleted for the same lot.
  const [media, setMedia] = useState<LotMedia | null>(null);
  const [mediaVersion, setMediaVersion] = useState(0);
  useEffect(() => {
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMedia(null);
    api
      .getLotMedia(lot.id)
      .then((m) => {
        if (!cancelled) setMedia(m);
      })
      .catch(() => {
        if (!cancelled) setMedia({ photo: false, voice: [] });
      });
    return () => {
      cancelled = true;
    };
  }, [lot.id]);
  const refreshMedia = () => {
    setMediaVersion((v) => v + 1);
    api.getLotMedia(lot.id).then(setMedia).catch(() => {});
  };

  function seedFields(l: Lot): Record<FocusTextField, string> {
    return {
      // Falls back to the catalogue's own imported Standard/Remarks columns — the broker's
      // file already carries these for some lots, so show that instead of a blank box.
      standardData: l.valuation?.standardData ?? catalogueStandardOf(l) ?? "",
      adjectiveData: l.valuation?.adjectiveData ?? "",
      brokerNotes: l.valuation?.brokerNotes ?? catalogueRemarkOf(l) ?? "",
      liquorRemarks: l.valuation?.liquorRemarks ?? "",
    };
  }

  // Re-seed the entry fields whenever a different lot comes into focus.
  const lotId = lot.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPair(valuationPairOf(lot));
    setActiveLine("from");
    setFieldText(seedFields(lot));
    setError(null);
    setClsNeeded(false);
    setAutoCls(false);
    setNoPrevData(false);
    // Give the value line focus — but never steal focus while the user is typing in
    // another field (the search bar / a filter / a remark box), or searching would be
    // interrupted the moment the first match changes the focused lot.
    const active = document.activeElement;
    const typingElsewhere =
      active instanceof HTMLElement &&
      active !== lineRefs.current.from &&
      active !== lineRefs.current.to &&
      (active.tagName === "INPUT" || active.tagName === "TEXTAREA" || active.getAttribute("role") === "combobox");
    if (!typingElsewhere) lineRefs.current.from?.focus();
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
  const savedPair = valuationPairOf(lot);
  const valuationDirty = pair.from !== savedPair.from || pair.to !== savedPair.to;
  const fieldDirty = (f: FocusTextField) => fieldText[f].trim() !== (v?.[f] ?? "").trim();
  const feedback = !error && valuationDirty ? valuationPairFeedback(pair.from, pair.to) : null;
  // While the typed value is valid and the tier isn't hand-picked, the previous sale's
  // suggestion previews as selected — it's saved together with the value.
  const liveParsed = valuationDirty ? parseValuationPair(pair.from, pair.to) : null;
  const liveValue = liveParsed ? effectiveOfParsed(liveParsed) : null;
  const mayAuto = currentCls === "Unclassified" || autoCls;
  const liveTier = mayAuto && liveValue !== null && gradeStats ? suggestTier(gradeStats, liveValue) : null;
  // A tier grades a valuation, so the tiers are only live once this lot has one — already
  // saved, or typed and valid, since tapping a tier saves the value along with it. Clearing
  // the lines takes the tier with them (enforced server-side too).
  const valuePresent = liveParsed ? liveParsed.kind === "single" || liveParsed.kind === "range" : saved;
  const displayCls = valuePresent ? (liveTier ?? currentCls) : "Unclassified";

  // A range's upper value has no meaning on its own, so the second line stays locked
  // (and the keypad's Range key with it) until the first line has a value.
  const rangeLineLocked = pair.from === "";

  // All text paths (typing, paste, keypad) funnel through here — the sanitizer keeps each
  // line to at most four digits no matter how the input arrives.
  const edit = (line: ValuationLine, updater: (prev: string) => string) => {
    setError(null);
    setPair((prev) => {
      const next = { ...prev, [line]: sanitizeValuationSide(updater(prev[line])) };
      // Emptying the value line takes the range with it — the second line is about to
      // lock, and leaving a number stranded behind a disabled field would be a trap.
      if (line === "from" && next.from === "") next.to = "";
      return next;
    });
    if (line === "from") setActiveLine("from");
  };

  /** Move the keypad (and the caret) to a line. */
  const goToLine = (line: ValuationLine) => {
    setActiveLine(line);
    lineRefs.current[line]?.focus();
  };

  const pressKey = (key: string) => {
    if (key === RANGE_KEY) {
      if (!rangeLineLocked) goToLine("to");
      return;
    }
    // The locked second line can never be the keypad's target, whatever was active last.
    const line = rangeLineLocked ? "from" : activeLine;
    if (key === "⌫") edit(line, (t) => t.slice(0, -1));
    else edit(line, (t) => t + key);
    lineRefs.current[line]?.focus();
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
      const parsed = parseValuationPair(pair.from, pair.to);
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
      if (parsed.kind === "clear") {
        // The value is gone, so the tier goes with it — hand-picked or not, a lot with no
        // valuation carries no classification.
        patch.classification = "Unclassified";
        autoApplied = false;
      } else if (patch.classification === undefined && (currentCls === "Unclassified" || autoCls)) {
        // Live auto-classification rides along with a new value while the tier is unset
        // or was itself auto-picked — an explicit tier in `extra` (a tap) always wins,
        // and a hand-picked tier is never touched.
        const liveValue = effectiveOfParsed(parsed);
        const tier = gradeStats && liveValue !== null ? suggestTier(gradeStats, liveValue) : null;
        if (tier) {
          patch.classification = tier;
          autoApplied = true;
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

  // Tapping a keyword chip adds it to the field (or removes it, if already there) — same
  // local-only edit as typing in the box. Nothing hits the server until the lot is left
  // (Save & Next / arrow / jump), same as every other field here — see saveAll.
  const toggleFieldKeyword = (field: FocusTextField, keyword: string) => {
    setFieldText((prev) => ({ ...prev, [field]: toggleKeyword(prev[field], keyword) }));
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
    if (index + 1 < total) {
      // Moving on in the normal flow leaves the sharing round-trip behind.
      setReturnAnchor(null);
      onNavigate(index + 1);
    }
  };

  const goTo = async (target: number) => {
    // Carry any typed values out with us, same as the grid's arrow-key navigation.
    const updated = await saveAll();
    if (!updated) return;
    if (target < 0 || target >= total) return;
    setReturnAnchor(null);
    onNavigate(target);
  };

  // Jump straight to a lot tapped in the filtered results strip, saving first.
  const jumpTo = async (id: string) => {
    if (id === lot.id) return;
    const updated = await saveAll();
    if (!updated) return;
    setReturnAnchor(null);
    onJump(id);
  };

  // Open a shared lot to value it, remembering the lot we left so the Back banner can
  // return here in one tap. Saves the current lot first (same as every move here does).
  const openSharing = async (target: Lot) => {
    if (target.id === lot.id) return;
    const from = { id: lot.id, label: shortLotLabel(lot) };
    const updated = await saveAll();
    if (!updated) return;
    setReturnAnchor(from);
    onJump(target.id);
  };

  // The Back banner: save this (shared) lot, then hop back to where the comparison started.
  const returnToAnchor = async () => {
    if (!returnAnchor) return;
    const backId = returnAnchor.id;
    const updated = await saveAll();
    if (!updated) return;
    setReturnAnchor(null);
    onJump(backId);
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

  // The details box shows the valuation live from the calculator, so what's on the keypad
  // and what the lot's details say never disagree while a value is being entered.
  const typedValuation = pair.to ? `${pair.from}-${pair.to}` : pair.from;
  // This lot's packing (net weight per bag) — a sharing on a different packing is flagged.
  const currentWtBag = weightPerChestOf(lot);

  const facts: { label: string; value: string | null | undefined; strong?: boolean }[] = [
    { label: "Lot No", value: lot.lotNumber, strong: true },
    { label: "Broker", value: lot.broker, strong: true },
    { label: "Selling Mark", value: sellingMarkOf(lot), strong: true },
    { label: "Mark Code", value: markCodeOf(lot) ?? lot.mark },
    { label: "Grade", value: lot.grade, strong: true },
    { label: "Bags", value: noOfChestsOf(lot) },
    { label: "Wt / Bag (kg)", value: weightPerChestOf(lot) },
    { label: "Standard", value: v?.standardData ?? catalogueStandardOf(lot) },
    { label: "Remark", value: catalogueRemarkOf(lot) ?? v?.adjectiveData },
    { label: "Liquor Remarks", value: v?.liquorRemarks },
    { label: valuationDirty ? "Valuation (unsaved)" : "Valuation", value: typedValuation || null, strong: true },
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
        const onValuationLine = e.target === lineRefs.current.from || e.target === lineRefs.current.to;
        if (e.key === "Escape") {
          e.preventDefault();
          onExit();
        } else if (e.key === "PageUp" || (e.key === "ArrowUp" && onValuationLine)) {
          e.preventDefault();
          goTo(index - 1);
        } else if (e.key === "PageDown" || (e.key === "ArrowDown" && onValuationLine)) {
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

      {/* ---- "you jumped here to compare" return banner ---- */}
      {returnAnchor && (
        <button
          type="button"
          onClick={returnToAnchor}
          title="Save this lot and go back to the lot you were valuing"
          className="flex items-center gap-2 px-3 md:px-5 py-3 border-b-2 shrink-0 text-left cursor-pointer touch-manipulation active:opacity-90 w-full"
          style={{ background: "var(--liquor)", color: "var(--paper-0)", borderColor: "var(--brass)" }}
        >
          <ArrowBackIcon sx={{ fontSize: 22 }} />
          <span className="font-bold text-[14px]">Back to {returnAnchor.label}</span>
          <span className="text-[12px] opacity-85 hidden sm:inline">— the lot you were valuing</span>
          <span className="ml-auto text-[12px] font-semibold opacity-90 whitespace-nowrap">Tap to return ↩</span>
        </button>
      )}

      {/* ---- collapsible per-column filter panel (same engine as Catalogue Manager) ---- */}
      {filtersOpen && (
        <div
          className="max-h-[42vh] overflow-y-auto px-3 md:px-5 pt-3 border-b border-border shrink-0"
          style={{ background: "var(--surface)" }}
        >
          <FilterPanel
            variant="valuation"
            headers={filters.headers}
            columnMeta={filters.columnMeta}
            lots={filters.lots}
            columnFilters={filters.columnFilters}
            onColumnFilterChange={filters.onColumnFilterChange}
            status={filters.ticketStatus}
            onStatusChange={filters.setTicketStatus}
            classification={filters.classification}
            onClassificationChange={filters.setClassification}
            year={filters.year}
            onYearChange={filters.setYear}
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
              className="px-4 py-2 border-b border-border flex flex-wrap items-center gap-x-2 gap-y-1"
              style={{ background: "var(--surface-sunken)" }}
            >
              <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">Lot Details</span>
              <button
                type="button"
                onClick={() => setSharingsOpen((o) => !o)}
                title="Show other brokers offering the same mark &amp; grade in this sale — compare packing and asking prices"
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[11.5px] font-semibold cursor-pointer touch-manipulation active:scale-[0.98] transition-transform"
                style={{
                  borderColor: sharings.length ? "var(--brass)" : "var(--border)",
                  background: sharingsOpen ? "var(--brass-dim)" : "transparent",
                  color: sharings.length ? "var(--text-strong)" : "var(--text-muted)",
                }}
              >
                <CompareArrowsIcon sx={{ fontSize: 16 }} />
                Sharings ({sharings.length})
              </button>
              {media && (
                <LotPhoto lotId={lot.id} has={media.photo} version={mediaVersion} onChanged={refreshMedia} />
              )}
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
            <div
              className="grid gap-x-4 gap-y-2.5 px-4 py-2.5"
              // Auto-fit columns + empty facts skipped keeps this to at most ~2 rows on a
              // tablet, so the tier buttons and keypad below stay reachable without scrolling.
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))" }}
            >
              {facts
                .filter((f) => f.value?.trim())
                .map((f) => (
                  <Fact key={f.label} {...f} />
                ))}
            </div>

            {/* ---- sharings: other brokers' lots of this same mark + grade ---- */}
            {sharingsOpen && (
              <div className="border-t border-border px-4 py-3" style={{ background: "var(--surface-sunken)" }}>
                {sharings.length === 0 ? (
                  <p className="text-[12.5px] text-text-muted m-0 leading-relaxed">
                    No other broker is offering{" "}
                    <strong style={{ color: "var(--text-strong)" }}>{sellingMarkOf(lot) ?? "this mark"}</strong>
                    {lot.grade ? ` · ${lot.grade}` : ""} in this sale.
                  </p>
                ) : (
                  <>
                    <p className="text-[11px] text-text-muted m-0 mb-2 leading-snug">
                      Same mark &amp; grade across brokers. Compare packing &amp; asking below, then tap another
                      broker&apos;s row to open and value that lot — a{" "}
                      <strong style={{ color: "var(--text-strong)" }}>Back</strong> bar then brings you straight here.
                    </p>
                    <div className="overflow-x-auto -mx-1 px-1">
                      <table className="w-full border-collapse text-[12.5px]">
                        <thead>
                          <tr>
                            {["Broker", "Lot", "Bags", "Wt/Bag", "Asking", "Valuation", "Go"].map((h) => (
                              <th
                                key={h}
                                className="font-mono text-[9px] tracking-widest uppercase text-text-muted font-semibold px-2 py-1 text-left whitespace-nowrap"
                              >
                                {h === "Go" ? "" : h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {sharings.map((l) => {
                            const isAnchor = returnAnchor?.id === l.id;
                            const wtBag = weightPerChestOf(l);
                            const diffPacking = !!wtBag && !!currentWtBag && wtBag !== currentWtBag;
                            const valText = valuationToText(l);
                            return (
                              <tr
                                key={l.id}
                                onClick={isAnchor ? () => returnToAnchor() : () => openSharing(l)}
                                title={isAnchor ? "Go back to this lot" : "Open this lot to value it"}
                                className="cursor-pointer touch-manipulation active:opacity-80"
                                style={{
                                  borderLeft: isAnchor ? "3px solid var(--brass)" : "3px solid transparent",
                                }}
                              >
                                <td className="px-2 py-2 whitespace-nowrap font-semibold" style={{ color: "var(--text)" }}>
                                  {l.broker || "—"}
                                  {isAnchor && <span className="text-text-muted font-normal"> · you came from here</span>}
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap font-mono">{l.lotNumber ?? "—"}</td>
                                <td className="px-2 py-2 whitespace-nowrap font-mono">{noOfChestsOf(l) ?? "—"}</td>
                                <td
                                  className="px-2 py-2 whitespace-nowrap font-mono"
                                  style={diffPacking ? { color: "var(--warn)", fontWeight: 700 } : undefined}
                                  title={diffPacking ? "Different packing from your lot" : undefined}
                                >
                                  {wtBag ?? "—"}
                                  {diffPacking ? " ≠" : ""}
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap font-mono">{askingPriceOf(l) ?? "—"}</td>
                                <td
                                  className="px-2 py-2 whitespace-nowrap font-mono font-semibold"
                                  style={{ color: valText ? "var(--text-strong)" : "var(--text-muted)" }}
                                >
                                  {valText || "—"}
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap text-right">
                                  {isAnchor ? (
                                    <span
                                      className="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold"
                                      style={{ background: "var(--liquor)", color: "var(--paper-0)" }}
                                    >
                                      ↩ Back
                                    </span>
                                  ) : (
                                    <span
                                      className="inline-block px-2.5 py-1 rounded-full text-[11px] font-bold border"
                                      style={{ borderColor: "var(--liquor)", color: "var(--liquor)" }}
                                    >
                                      Open →
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </div>
            )}
          </Paper>

          {/* classification tiers, flanked by big tap-friendly previous/next-lot buttons —
              a tablet-sized alternative to the small chevrons up in the top bar. Reuses
              goTo, so leaving the lot saves everything first exactly like those do. */}
          <div className="flex items-stretch gap-2 mb-1">
            <button
              type="button"
              disabled={index === 0 || saving}
              onClick={() => goTo(index - 1)}
              aria-label="Previous lot"
              title="Previous lot"
              className="shrink-0 w-14 sm:w-16 rounded-xl border-2 cursor-pointer touch-manipulation active:scale-[0.97] transition-transform flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-strong)" }}
            >
              <ChevronLeftIcon sx={{ fontSize: 30 }} />
            </button>

            <div
              className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl flex-1"
              style={clsNeeded ? { outline: "2px solid var(--warn)", outlineOffset: 3 } : undefined}
            >
              {CLASSIFICATIONS.map((c) => {
                const active = displayCls === c.value;
                const tierInfo = tierStatsFor(gradeStats, c.value);
                return (
                  <button
                    key={c.value}
                    type="button"
                    disabled={saving || !valuePresent}
                    onClick={() => commitClassification(c.value)}
                    title={
                      !valuePresent
                        ? "Enter a valuation first — a classification grades a value"
                        : active
                          ? "Tap again to unset"
                          : `Mark as ${c.label}`
                    }
                    className="min-h-[52px] rounded-lg border-2 cursor-pointer touch-manipulation active:scale-[0.98] transition-transform py-1.5 disabled:cursor-not-allowed"
                    style={{
                      borderColor: c.color,
                      background: active ? c.color : "var(--surface)",
                      color: active ? "var(--paper-0)" : c.color,
                      opacity: valuePresent ? 1 : 0.4,
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

            <button
              type="button"
              disabled={index + 1 >= total || saving}
              onClick={() => goTo(index + 1)}
              aria-label="Next lot"
              title="Next lot"
              className="shrink-0 w-14 sm:w-16 rounded-xl border-2 cursor-pointer touch-manipulation active:scale-[0.97] transition-transform flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--liquor)", background: "var(--liquor)", color: "var(--paper-0)" }}
            >
              <ChevronRightIcon sx={{ fontSize: 30 }} />
            </button>
          </div>
          <div className="min-h-[20px] mb-1.5">
            {!valuePresent && (
              <span className="text-[11.5px] font-semibold text-text-muted">
                Enter a valuation first — a lot with no value carries no classification
              </span>
            )}
            {valuePresent && liveTier && gradeStats && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--sage-dark)" }}>
                Auto-selects on save · {tierSummary(lot.grade, gradeStats, liveTier)} — tap another tier to override
              </span>
            )}
            {valuePresent && !liveTier && autoCls && gradeStats && currentCls !== "Unclassified" && (
              <span className="text-[11.5px] font-semibold" style={{ color: "var(--sage-dark)" }}>
                Auto-selected · {tierSummary(lot.grade, gradeStats, currentCls)} — tap another tier to override
              </span>
            )}
            {valuePresent && mayAuto && liveValue !== null && !gradeStats && (
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
                sx={{ borderColor: "var(--border)", p: 1.5, display: "flex", flexDirection: "column", height: FOCUS_CARD_HEIGHT }}
              >
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">{f.label}</span>
                </div>
                {media && (
                  <div className="mb-1.5">
                    <VoiceRecorder
                      lotId={lot.id}
                      field={f.value}
                      has={media.voice.includes(f.value)}
                      version={mediaVersion}
                      onChanged={refreshMedia}
                    />
                  </div>
                )}
                <KeywordChips
                  field={f.value}
                  value={fieldText[f.value]}
                  disabled={saving}
                  fixedHeight={FOCUS_CHIPS_HEIGHT}
                  onToggle={(keyword) => toggleFieldKeyword(f.value, keyword)}
                />
                <textarea
                  value={fieldText[f.value]}
                  placeholder={f.placeholder}
                  disabled={saving}
                  onChange={(e) => setFieldText((prev) => ({ ...prev, [f.value]: e.target.value }))}
                  className="flex-1 w-full resize-none bg-transparent border border-border rounded-md px-2.5 py-2 text-[13px] leading-relaxed outline-none min-h-0"
                  style={{ color: "var(--text)" }}
                />
              </Paper>
            ))}

            {/* calculator container — most right */}
            <Paper
              variant="outlined"
              sx={{ borderColor: "var(--brass)", p: 1.5, display: "flex", flexDirection: "column", height: FOCUS_CARD_HEIGHT }}
            >
              <div className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-1.5">
                Valuation (LKR) — up to {VALUATION_MAX_DIGITS} digits
              </div>
              {/* Two lines instead of one dash-separated field: fill the first alone for a
                  single value, both for a range. The active line is what the keypad types
                  into, and is outlined so it's obvious which one that is. */}
              {VALUATION_LINES.map(({ line, prefix, label, placeholder }) => {
                const locked = line === "to" && rangeLineLocked;
                const active = activeLine === line && !locked;
                return (
                  <div key={line} className="flex items-center gap-1.5 mb-1">
                    <span
                      className="text-[11px] font-mono shrink-0 w-[26px] text-right"
                      style={{ color: locked ? "var(--border)" : "var(--text-muted)" }}
                    >
                      {prefix}
                    </span>
                    <input
                      ref={(el) => {
                        lineRefs.current[line] = el;
                      }}
                      type="text"
                      inputMode="numeric"
                      autoFocus={line === "from"}
                      aria-label={label}
                      placeholder={locked ? "enter the value first" : placeholder}
                      title={locked ? "Type the value on the line above first" : undefined}
                      className="w-full min-w-0 px-2.5 py-1.5 rounded-lg border-2 text-[19px] font-mono font-semibold bg-transparent tracking-wide disabled:cursor-not-allowed"
                      style={{
                        borderColor: error && !locked ? "var(--danger)" : active ? "var(--brass)" : "var(--border)",
                        color: "var(--text-strong)",
                        opacity: locked ? 0.45 : 1,
                      }}
                      value={pair[line]}
                      disabled={saving || locked}
                      onFocus={() => setActiveLine(line)}
                      onChange={(e) => {
                        setActiveLine(line);
                        edit(line, () => e.target.value);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          saveAndNext();
                        }
                      }}
                    />
                  </div>
                );
              })}
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
                {KEYPAD_ROWS.flat().map((key) => {
                  const isRange = key === RANGE_KEY;
                  // Locked in step with the second line itself — no range before a value.
                  const rangeLocked = isRange && rangeLineLocked;
                  const rangeArmed = isRange && activeLine === "to" && !rangeLineLocked;
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={saving || rangeLocked}
                      onClick={() => pressKey(key)}
                      aria-label={key === "⌫" ? "Backspace" : isRange ? "Type the range's upper value" : key}
                      title={
                        isRange
                          ? rangeLocked
                            ? "Type the value first, then add its upper end"
                            : "Enter an upper value — makes this a range"
                          : undefined
                      }
                      className={`min-h-[48px] rounded-lg border font-semibold font-mono cursor-pointer touch-manipulation active:scale-[0.97] transition-transform disabled:cursor-not-allowed ${
                        isRange ? "text-[12px]" : "text-[19px]"
                      }`}
                      style={{
                        borderColor: rangeArmed ? "var(--brass)" : "var(--border)",
                        background: rangeArmed ? "var(--brass-dim)" : "var(--surface-alt)",
                        color: key === "⌫" ? "var(--danger)" : "var(--text-strong)",
                        opacity: rangeLocked ? 0.4 : 1,
                      }}
                    >
                      {key === "⌫" ? <BackspaceOutlinedIcon sx={{ fontSize: 20, verticalAlign: "middle" }} /> : key}
                    </button>
                  );
                })}
                <button
                  type="button"
                  disabled={saving}
                  onClick={() => {
                    setError(null);
                    setPair({ from: "", to: "" });
                    goToLine("from");
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
