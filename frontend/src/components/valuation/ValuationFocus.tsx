"use client";

import {
  CLASSIFICATIONS,
  SUB_GRADE_SUFFIXES,
  subGradeCode,
  type SubGradeSuffix,
} from "@/lib/classifications";
import { subGradeCodeOf, subGradeEntryOf, withSubGrade } from "@/lib/subGrade";
import { api, type LotMedia } from "@/lib/api";
import LotPhoto from "@/components/valuation/LotPhoto";
import dynamic from "next/dynamic";
import {
  askingPriceOf,
  catalogueRemarkOf,
  catalogueStandardOf,
  hasValuation,
  isReprintLot,
  markCodeOf,
  minimumLimitOf,
  noOfChestsOf,
  purchasedPriceOf,
  registeredBidOf,
  reprintValueOf,
  sellingMarkOf,
  statusOf,
  valuationPairOf,
  valuationToText,
  weightPerChestOf,
} from "@/lib/lotDisplay";
import { OUR_BROKER } from "@/lib/ourBroker";
import { buildSharingIndex, sharingsFor, sharingsInOtherSale } from "@/lib/sharings";
import {
  parseValuationInput,
  parseValuationPair,
  sanitizeValuationInput,
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
  subBandRange,
  suggestSubGrade,
  suggestTier,
  tierStatsFor,
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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// Loaded on demand — MediaRecorder-based, can't run on the server, and most lots are
// worked without ever opening a voice note, so this shouldn't ship in the initial bundle.
const VoiceRecorder = dynamic(() => import("@/components/valuation/VoiceRecorder"), { ssr: false });

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
  /** Previous sale's lots (all of it, not just this mark+grade) — for the Sharings panel's
   *  cross-sale comparison. Empty while it's still loading or there is no previous sale. */
  previousSaleLots: Lot[];
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

type FocusTextField = "adjectiveData" | "brokerNotes" | "liquorRemarks";

// The three remark columns worked alongside the valuation, left to right; the calculator
// keypad takes the fourth (right-most) container. Standard has no column of its own — it
// holds a single sub-grade code, which the picker above this row owns outright.
const FOCUS_TEXT_FIELDS: { value: FocusTextField; label: string; placeholder: string }[] = [
  { value: "adjectiveData", label: "Adjectives", placeholder: "Tap a term above, or type your own…" },
  { value: "brokerNotes", label: "Remarks", placeholder: "Tap a term above, or type your own…" },
  { value: "liquorRemarks", label: "Liquor Remarks", placeholder: "Tap a term above, or type your own…" },
];

/** One fact cell in the lot-details box. */
function Fact({ label, value, strong }: { label: string; value: string | null | undefined; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <div className="font-mono text-[10.5px] tracking-widest uppercase text-text-muted mb-0.5 truncate" title={label}>
        {label}
      </div>
      <div
        className={`text-[15px] leading-snug truncate ${strong ? "font-bold text-text-strong" : "text-text"}`}
        // One line, ellipsised, with the full text on the tooltip. The details box is on
        // screen permanently now, so every row it spends is a row the keypad below loses —
        // and only the remark-style values ever ran long enough to need a second line.
        title={value?.trim() || undefined}
      >
        {value?.trim() ? value : "—"}
      </div>
    </div>
  );
}

// The entry row no longer pins its cards to a pixel height. On a tablet the whole view is
// meant to sit inside the screen with nothing to scroll, so the row takes whatever height
// is left over and the cards divide it: `gridAutoRows: 1fr` keeps every row of the grid
// equal (which is what the old fixed height was working around — grid row-stretch alone
// only equalizes within a row, so wrapping to 2 columns used to produce uneven cards),
// and each card then splits its own height between keyword chips and the text box by
// share, not by pixels. Same slot for every card, so the boxes still line up exactly.
// Chips-to-textarea split inside a card, as flex-grow ratios against a zero basis rather
// than a percentage. A percentage basis resolves against an indefinite height by falling
// back to the content size, and paired with flex-shrink:0 that let the tallest chip list
// (Adjectives, 15 terms) dictate the height of the entire entry row — 478px instead of the
// 452px the layout had to give it. Growth ratios split whatever the row hands down and
// stay shrinkable, so the cards follow the screen instead of the other way round.
const CHIPS_GROW = 38;
const TEXT_GROW = 62;

/** The two lines of the calculator: the value itself, and the optional upper end of a range. */
type ValuationLine = "from" | "to";

const VALUATION_LINES: { line: ValuationLine; prefix: string; label: string; placeholder: string }[] = [
  // Placeholders stay short: the card is a quarter of the screen and the input is 24px, so
  // anything longer is cut off mid-word rather than read.
  { line: "from", prefix: "Rs.", label: "Valuation", placeholder: "e.g. 1250" },
  { line: "to", prefix: "to", label: "Range upper value", placeholder: "range end" },
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
  previousSaleLots,
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
  // The Standard field, held apart from the remark boxes because it has no box of its own:
  // the sub-grade picker is its only writer. Kept as the whole string (not just the code) so
  // any free text a legacy ticket left in there survives a save untouched.
  const [standardText, setStandardText] = useState(() => lot.valuation?.standardData ?? "");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [clsNeeded, setClsNeeded] = useState(false);
  // Current classification was auto-picked from the previous sale (labels the hint line).
  const [autoCls, setAutoCls] = useState(false);
  // The Standard sub-grade was auto-picked from the previous sale (so a tier change may re-pick it).
  const [autoSub, setAutoSub] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  // "Sharings" comparison panel — other brokers' lots of this same mark + grade.
  const [sharingsOpen, setSharingsOpen] = useState(false);
  // The lot you left when you tapped a sharing — drives the one-tap "Back to your lot"
  // banner so you can value a shared lot and return without hunting for where you were.
  const [returnAnchor, setReturnAnchor] = useState<{ id: string; label: string } | null>(null);
  // Per-sharing valuation typed straight into the comparison row, keyed by lot id, so a
  // sharing can be priced without leaving this lot. Empty entry = untouched.
  const [sharingDraft, setSharingDraft] = useState<Record<string, string>>({});
  const [savingSharingId, setSavingSharingId] = useState<string | null>(null);
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
  // How this same mark + grade fared last sale — every broker's, since there's no "anchor
  // lot" to exclude across sales the way there is for this-sale peers above.
  const previousSaleSharings = useMemo(
    () => sharingsInOtherSale(lot, previousSaleLots),
    [lot, previousSaleLots]
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
      adjectiveData: l.valuation?.adjectiveData ?? "",
      // Falls back to the catalogue's own imported Remarks column — the broker's file
      // already carries that for some lots, so show it instead of a blank box.
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
    setStandardText(lot.valuation?.standardData ?? "");
    setError(null);
    setClsNeeded(false);
    setAutoCls(false);
    setAutoSub(false);
    setSharingDraft({});
    setSharingsOpen(false);
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

  // ---- Standard sub-grade (the previous sale's tier band, split into four) ----
  // The sub-grade nests under the currently shown main tier and is the Standard field's
  // single token — this picker is the only thing that writes it, anywhere in the app.
  const displayTier = CLASSIFICATIONS.find((c) => c.value === displayCls) ?? null;
  const subTierStats = displayCls !== "Unclassified" ? tierStatsFor(gradeStats, displayCls) : null;
  const currentSubEntry = subGradeEntryOf(standardText);
  const currentSubCode = currentSubEntry?.code ?? null;
  // The value graded for the sub-band: the live typed value, else the saved one.
  const subValue = liveValue ?? effectiveValuationOf(lot);
  // Auto-pick the sub-grade while none is hand-set (or the set one belongs to another tier).
  const mayAutoSub = !currentSubEntry || autoSub || currentSubEntry.tier !== displayCls;
  const liveSubSuffix =
    valuePresent && displayCls !== "Unclassified" && subTierStats && subValue !== null && mayAutoSub
      ? suggestSubGrade(subTierStats, subValue)
      : null;
  const displaySubSuffix: SubGradeSuffix | null =
    currentSubEntry && currentSubEntry.tier === displayCls ? currentSubEntry.suffix : liveSubSuffix;
  // The sub-grade row is always on screen and simply goes quiet until there is a value and
  // a tier to grade. It used to mount only once both existed, so typing a valuation grew
  // the page by a whole row and shifted everything below it — on a tablet that moves the
  // buttons out from under the finger that is already on its way down.
  const subEnabled = valuePresent && displayTier !== null;
  const subColor = displayTier?.color ?? "var(--text-muted)";

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
    let subApplied: boolean | null = null;
    // The value this save grades against — the freshly typed value when the lines changed,
    // else the value already on the lot; null once the value is cleared.
    let gradedValue: number | null = valuationDirty ? null : effectiveValuationOf(lot);
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
        gradedValue = null;
      } else {
        gradedValue = effectiveOfParsed(parsed);
        if (patch.classification === undefined && (currentCls === "Unclassified" || autoCls)) {
          // Live auto-classification rides along with a new value while the tier is unset
          // or was itself auto-picked — an explicit tier in `extra` (a tap) always wins,
          // and a hand-picked tier is never touched.
          const tier = gradeStats && gradedValue !== null ? suggestTier(gradeStats, gradedValue) : null;
          if (tier) {
            patch.classification = tier;
            autoApplied = true;
          }
        }
      }
    }
    // The remark fields save verbatim; Standard is handled below, where the auto sub-grade
    // is folded in.
    FOCUS_TEXT_FIELDS.forEach((f) => {
      if (fieldDirty(f.value)) {
        const trimmed = fieldText[f.value].trim();
        patch[f.value] = trimmed === "" ? null : trimmed;
      }
    });
    // Standard field, with the previous-sale sub-grade folded in. An explicit standardData in
    // `extra` (a sub-grade tap) is the final word; otherwise the sub-grade auto-fills under
    // the tier this save settles on, while it's unset or was itself auto — the exact rule the
    // main classification follows. No tier means no sub-grade.
    {
      const stdProvided = extra?.standardData !== undefined;
      let stdOut = stdProvided ? (extra!.standardData ?? "") : standardText;
      if (!stdProvided) {
        const tierAfter = (patch.classification ?? currentCls) as ClassificationValue;
        if (tierAfter === "Unclassified") {
          stdOut = withSubGrade(stdOut, null);
          if (subGradeCodeOf(standardText)) subApplied = false;
        } else {
          const existing = subGradeEntryOf(stdOut);
          const canAutoSub = !existing || autoSub || existing.tier !== tierAfter;
          if (canAutoSub && gradedValue !== null) {
            const ts = tierStatsFor(gradeStats, tierAfter);
            const suffix = ts ? suggestSubGrade(ts, gradedValue) : null;
            if (suffix) {
              stdOut = withSubGrade(stdOut, subGradeCode(tierAfter, suffix));
              subApplied = true;
            }
          }
        }
      }
      const savedStd = (v?.standardData ?? "").trim();
      const outTrim = stdOut.trim();
      if (outTrim !== savedStd) patch.standardData = outTrim === "" ? null : outTrim;
    }
    if (Object.keys(patch).length === 0) return lot;

    setSaving(true);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
      onLotUpdated(updated);
      setError(null);
      if (autoApplied !== null) setAutoCls(autoApplied);
      if (subApplied !== null) setAutoSub(subApplied);
      // Keep the local Standard string in step with what was actually saved, so the picker
      // and the badge both reflect the folded-in sub-grade.
      if (patch.standardData !== undefined) setStandardText(updated.valuation?.standardData ?? "");
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
  const toggleFieldKeyword = useCallback((field: FocusTextField, keyword: string) => {
    setFieldText((prev) => ({ ...prev, [field]: toggleKeyword(prev[field], keyword) }));
  }, []);

  // One stable handler per field. An inline `(kw) => toggleFieldKeyword(f.value, kw)` in the
  // render would be a new function every time, which defeats the memo on KeywordChips and
  // re-renders every chip on any state change here.
  const chipHandlers = useMemo(
    () =>
      Object.fromEntries(
        FOCUS_TEXT_FIELDS.map((f) => [f.value, (keyword: string) => toggleFieldKeyword(f.value, keyword)])
      ) as Record<FocusTextField, (keyword: string) => void>,
    [toggleFieldKeyword]
  );

  // Auto-pick a classification from the previous sale's record for this grade.
  // Returns the updated lot, or null when there's no usable history / the save failed.
  const autoClassify = async (l: Lot): Promise<Lot | null> => {
    const value = effectiveValuationOf(l);
    const tier = gradeStats && value !== null ? suggestTier(gradeStats, value) : null;
    if (!tier) return null;
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

  /**
   * Price a sharing from the comparison row, without leaving this lot.
   *
   * A sharing is the same selling mark AND the same grade (see sharingKey), so the very
   * previous-sale bands driving this lot's tiers apply to it unchanged — the classification
   * and Standard sub-grade can be derived here exactly as they are in saveAll, rather than
   * being left for a later trip into that lot. Anything already hand-set on the target is
   * left alone: the tier is only filled when it is still Unclassified, and the sub-grade
   * only when it holds none for that tier.
   */
  const saveSharingValue = async (target: Lot, raw: string) => {
    const parsed = parseValuationInput(raw);
    if (parsed.kind === "error") return;
    const patch: Partial<ValuationUpdate> = {};
    if (parsed.kind === "clear") {
      patch.valuationSingle = null;
      patch.valuationFrom = null;
      patch.valuationTo = null;
      // No value means no grading, the same rule the main entry enforces.
      patch.classification = "Unclassified";
      patch.standardData = withSubGrade(target.valuation?.standardData, null) || null;
    } else {
      if (parsed.kind === "single") {
        patch.valuationSingle = parsed.value;
        patch.valuationFrom = null;
        patch.valuationTo = null;
      } else {
        patch.valuationSingle = null;
        patch.valuationFrom = parsed.from;
        patch.valuationTo = parsed.to;
      }
      const value = effectiveOfParsed(parsed);
      const targetCls = target.valuation?.classification ?? "Unclassified";
      const tier =
        gradeStats && targetCls === "Unclassified" && value !== null ? suggestTier(gradeStats, value) : null;
      if (tier) patch.classification = tier;
      const tierAfter = tier ?? targetCls;
      if (tierAfter !== "Unclassified" && value !== null) {
        const existing = subGradeEntryOf(target.valuation?.standardData);
        if (!existing || existing.tier !== tierAfter) {
          const ts = tierStatsFor(gradeStats, tierAfter as ClassificationValue);
          const suffix = ts ? suggestSubGrade(ts, value) : null;
          if (suffix) {
            patch.standardData =
              withSubGrade(target.valuation?.standardData, subGradeCode(tierAfter as ClassificationValue, suffix)) ||
              null;
          }
        }
      }
    }
    setSavingSharingId(target.id);
    try {
      const updated = await api.updateValuation(target.id, buildValuationUpdate(target, patch));
      onLotUpdated(updated);
      setSharingDraft((prev) => {
        const next = { ...prev };
        delete next[target.id];
        return next;
      });
    } catch {
      setError("Save failed — try again");
    } finally {
      setSavingSharingId(null);
    }
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
    // A hand-picked tier is an override — the auto flag no longer applies.
    setAutoCls(false);
    if (next !== "Unclassified") setClsNeeded(false);
  };

  // Tapping a sub-grade writes its code into the Standard field (tapping the active one
  // clears it), staying on this lot like a tier tap does. A sub-grade needs a main tier, so
  // when only a live tier is previewed it's committed along with the sub-grade.
  const commitSubGrade = async (suffix: SubGradeSuffix) => {
    if (displayCls === "Unclassified") return;
    const code = subGradeCode(displayCls, suffix);
    const clearing = currentSubCode === code;
    const nextStd = withSubGrade(standardText, clearing ? null : code);
    const extra: Partial<ValuationUpdate> = { standardData: nextStd === "" ? null : nextStd };
    // No saved tier yet, only the previewed one — commit it so the sub-grade has a home.
    if (currentCls === "Unclassified") extra.classification = displayCls;
    // A hand-picked sub-grade is an override — later tier changes won't silently re-pick it.
    setAutoSub(false);
    await saveAll(extra);
  };

  // The details box shows the valuation live from the calculator, so what's on the keypad
  // and what the lot's details say never disagree while a value is being entered.
  const typedValuation = pair.to ? `${pair.from}-${pair.to}` : pair.from;
  // This lot's packing (net weight per bag) — a sharing on a different packing is flagged.
  const currentWtBag = weightPerChestOf(lot);

  // `always` keeps a fact in the grid even while it is empty. Only the valuation needs it:
  // it is the one fact that fills in as you type, and letting it appear from nothing adds a
  // cell — often a whole new grid row — which shifts the tiers and keypad down mid-entry.
  // Reserving its slot costs one "—" and keeps the box a fixed height for a given lot.
  const facts: { label: string; value: string | null | undefined; strong?: boolean; always?: boolean }[] = [
    { label: "Lot No", value: lot.lotNumber, strong: true },
    { label: "Broker", value: lot.broker, strong: true },
    { label: "Selling Mark", value: sellingMarkOf(lot), strong: true },
    { label: "Mark Code", value: markCodeOf(lot) ?? lot.mark },
    { label: "Grade", value: lot.grade, strong: true },
    { label: "RP", value: reprintValueOf(lot), strong: isReprintLot(lot) },
    { label: "Bags", value: noOfChestsOf(lot) },
    { label: "Wt / Bag (kg)", value: weightPerChestOf(lot) },
    // The broker's own Standard column, read-only — our sub-grade reads off the picker's
    // badge instead, so the two are never confused for one another. Empty in every sale
    // file to date, in which case this fact simply drops out below.
    { label: "Standard (catalogue)", value: catalogueStandardOf(lot) },
    { label: "Remark", value: catalogueRemarkOf(lot) ?? v?.adjectiveData },
    { label: "Liquor Remarks", value: v?.liquorRemarks },
    { label: valuationDirty ? "Valuation (unsaved)" : "Valuation", value: typedValuation || null, strong: true, always: true },
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
        // Free-text fields (search, remarks, adjective/liquor text…) get to keep every
        // letter the taster types — "S" is far too common a letter to hijack there. The
        // valuation lines are numeric-purpose, so "S" passing through them is harmless
        // (sanitizeValuationSide strips it right back out) and this is also the device the
        // shortcut is most useful on: a keyboard-equipped tablet, mid-entry.
        const target = e.target as HTMLElement;
        const typingFreeText = !onValuationLine && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
        if (e.key === "Escape") {
          e.preventDefault();
          onExit();
        } else if (e.key === "PageUp" || (e.key === "ArrowUp" && onValuationLine)) {
          e.preventDefault();
          goTo(index - 1);
        } else if (e.key === "PageDown" || (e.key === "ArrowDown" && onValuationLine)) {
          e.preventDefault();
          goTo(index + 1);
        } else if (
          (e.key === "s" || e.key === "S") &&
          !typingFreeText &&
          !e.metaKey &&
          !e.ctrlKey &&
          !e.altKey &&
          (sharingsOpen || sharings.length > 0 || previousSaleSharings.length > 0)
        ) {
          // Toggles either way — opens when there's something to compare, and always
          // closes on a second press even if the underlying data changed in between.
          e.preventDefault();
          setSharingsOpen((o) => !o);
        }
      }}
    >
      {/* ---- top bar: exit, universal search, filters, position ---- */}
      {/* The brand's olive→gold rule, so focus mode still reads as Asia Siyaka even with
          the sidebar hidden behind the overlay. */}
      <div className="brand-rule h-[3px] shrink-0" />
      <div
        className="flex items-center gap-2 flex-wrap px-3 md:px-5 py-2.5 border-b border-border shrink-0"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
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
        <span className="text-[13px] text-text-muted font-mono font-semibold whitespace-nowrap ml-auto">
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
                className="flex items-center gap-1.5 px-3 py-2 rounded-full border-2 text-[13px] font-semibold whitespace-nowrap cursor-pointer touch-manipulation shrink-0"
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

      {/* ---- work area ----
           `min-h-full` on the inner column plus `flex-1` on the entry row means: when the
           screen is tall enough, the row stretches to eat the leftover space and the view
           fits the tablet exactly with nothing to scroll. When it isn't, the row holds its
           420px floor (the height the calculator needs before its keypad starts clipping)
           and this container scrolls instead. Fits when it can, scrolls when it must —
           never silently cuts the keypad off. The floor is the calculator's own stack
           measured out: 24 padding + 22 header + 106 for the two value lines + 23 feedback
           + 244 keypad (5 rows at the 44px minimum plus gaps) = 419, rounded up to 440. */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <div className="max-w-[1600px] mx-auto px-3 md:px-5 py-1.5 flex flex-col gap-1 min-h-full">
          {/* lot details box */}
          {/* `relative` anchors the floating sharings panel below this box. */}
          <Paper
            variant="outlined"
            sx={{ borderColor: "var(--border)", flexShrink: 0, boxShadow: "var(--shadow-sm)", position: "relative" }}
          >
            <div
              // Sits above the tap-away scrim (z-20) so the Sharings button below stays a
              // real toggle while the panel is open. Without this the scrim covered it and
              // the second press landed on the scrim instead of the button — the panel still
              // closed, but the control looked dead and a quick double-tap did nothing at all.
              className="relative z-40 px-4 py-1.5 border-b border-border flex flex-wrap items-center gap-x-2 gap-y-1"
              style={{ background: "var(--surface-sunken)" }}
            >
              {/* Identity strip — who this lot is, always on screen even with the fact
                  grid collapsed, so the taster never types a value against the wrong lot. */}
              <span className="text-[15px] font-bold text-text-strong whitespace-nowrap">
                {lot.lotNumber ? `Lot ${lot.lotNumber}` : lot.rowKey}
              </span>
              {isReprintLot(lot) && (
                <span
                  title="Broker-flagged reprint lot"
                  className="px-1.5 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap"
                  style={{ background: "var(--info)", color: "var(--paper-0)" }}
                >
                  RP
                </span>
              )}
              {sellingMarkOf(lot) && (
                <span className="text-[15px] font-semibold text-text whitespace-nowrap">{sellingMarkOf(lot)}</span>
              )}
              {lot.grade && (
                <span
                  className="text-[13px] font-bold font-mono px-2 py-0.5 rounded"
                  style={{ background: "var(--brass-dim)", color: "var(--text-strong)" }}
                >
                  {lot.grade}
                </span>
              )}
              {askingPriceOf(lot) && (
                <span className="text-[13px] text-text-muted whitespace-nowrap">
                  Asking <strong style={{ color: "var(--text-strong)" }}>{askingPriceOf(lot)}</strong>
                </span>
              )}
              {/* Inert when there is nothing to compare. It used to open a panel that said
                  only "no other broker is offering this" — pressing a button and getting a
                  near-empty box reads as the button being broken, where a disabled control
                  labelled "Sharings (0)" says the same thing without the round trip. */}
              <button
                type="button"
                disabled={sharings.length === 0 && previousSaleSharings.length === 0}
                onClick={() => setSharingsOpen((o) => !o)}
                title={
                  sharings.length === 0 && previousSaleSharings.length === 0
                    ? `No other broker is offering ${sellingMarkOf(lot) ?? "this mark"}${
                        lot.grade ? ` · ${lot.grade}` : ""
                      } in this sale or the previous one`
                    : sharingsOpen
                      ? "Hide the comparison (S)"
                      : "Compare this same mark & grade against other brokers this sale and the previous sale — price it here (S)"
                }
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-[13px] font-semibold touch-manipulation transition-transform enabled:cursor-pointer enabled:active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-45"
                style={{
                  borderColor: sharings.length || previousSaleSharings.length ? "var(--brass)" : "var(--border)",
                  background: sharingsOpen ? "var(--brass-dim)" : "transparent",
                  color: sharings.length || previousSaleSharings.length ? "var(--text-strong)" : "var(--text-muted)",
                }}
              >
                <CompareArrowsIcon sx={{ fontSize: 16 }} />
                Sharings ({sharings.length + previousSaleSharings.length})
              </button>
              {media && (
                <LotPhoto lotId={lot.id} has={media.photo} version={mediaVersion} onChanged={refreshMedia} />
              )}
              <span
                className="ml-auto flex items-center gap-1.5 text-[13px] font-bold px-3 py-1 rounded-full"
                style={{
                  background: complete ? "var(--sage-light)" : saved ? "var(--warn-light)" : "transparent",
                  color: complete ? "var(--sage-dark)" : saved ? "var(--warn)" : "var(--text-muted)",
                }}
              >
                {complete ? (
                  <>
                    <CheckCircleIcon sx={{ fontSize: 17 }} />
                    Valued &amp; classified
                  </>
                ) : saved ? (
                  <>
                    <RadioButtonUncheckedIcon sx={{ fontSize: 17 }} />
                    Classification pending
                  </>
                ) : (
                  <>
                    <RadioButtonUncheckedIcon sx={{ fontSize: 17 }} />
                    Not valued yet
                  </>
                )}
              </span>
            </div>
            <div
              className="grid gap-x-4 gap-y-1 px-4 py-1.5 border-t border-border"
              style={{ gridTemplateColumns: "repeat(auto-fit, minmax(128px, 1fr))" }}
            >
              {facts
                .filter((f) => f.always || f.value?.trim())
                .map((f) => (
                  <Fact key={f.label} {...f} />
                ))}
            </div>

            {/* ---- sharings: other brokers' lots of this same mark + grade ----
                 Floated, not inserted. As a sibling in the details box this panel grew the
                 box, which pushed the tiers and the keypad down the screen the moment it
                 opened — the layout moved under whatever the taster was about to tap.
                 Positioned absolutely it hangs over the work area instead, so opening and
                 closing the comparison never reflows anything behind it. */}
            {sharingsOpen && (
              <>
                {/* Tap-away close, and a guard so a tap meant for the panel can't land on a
                    tier button underneath it. */}
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setSharingsOpen(false)}
                  aria-hidden
                />
                <div
                  className="absolute left-0 right-0 top-full mt-1 z-30 rounded-xl border-2 overflow-hidden"
                  style={{
                    borderColor: "var(--brass)",
                    background: "var(--surface)",
                    boxShadow: "var(--shadow-lg)",
                  }}
                >
                  <div
                    className="flex items-center gap-2 px-4 py-2 border-b border-border"
                    style={{ background: "var(--surface-sunken)" }}
                  >
                    <span className="font-mono text-[11px] tracking-widest uppercase text-text-muted font-semibold">
                      Sharings · {sellingMarkOf(lot) ?? "this mark"}
                      {lot.grade ? ` · ${lot.grade}` : ""}
                    </span>
                    <button
                      type="button"
                      onClick={() => setSharingsOpen(false)}
                      className="ml-auto px-3 py-1 rounded-full border text-[13px] font-semibold cursor-pointer touch-manipulation"
                      style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                    >
                      Close
                    </button>
                  </div>
                  <div className="px-4 py-3 max-h-[46vh] overflow-y-auto">
                {sharings.length === 0 ? (
                  <p className="text-[12.5px] text-text-muted m-0 leading-relaxed">
                    No other broker is offering{" "}
                    <strong style={{ color: "var(--text-strong)" }}>{sellingMarkOf(lot) ?? "this mark"}</strong>
                    {lot.grade ? ` · ${lot.grade}` : ""} in this sale.
                  </p>
                ) : (
                  <>
                    <div className="overflow-x-auto -mx-1 px-1">
                      <table className="w-full border-collapse text-[13px]">
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
                            const busy = savingSharingId === l.id;
                            // The row's field falls back to whatever is already saved on that
                            // lot, so it reads as its valuation until you change something.
                            const draft = sharingDraft[l.id] ?? valText ?? "";
                            const dirty = draft.trim() !== (valText ?? "").trim();
                            const valid = draft.trim() === "" || parseValuationInput(draft).kind !== "error";
                            // One-tap copy of this lot's price. Same mark, same grade — most
                            // sharings take the same value, so this is the common case and
                            // deserves to be a single tap rather than a retype.
                            const canCopy =
                              !!typedValuation && typedValuation.trim() !== "" && typedValuation !== draft;
                            // What the row's saved value actually graded to. Saving here fills
                            // the tier and Standard as well, and without showing them you would
                            // have to open the lot just to confirm the save did its whole job.
                            const lTier = CLASSIFICATIONS.find((c) => c.value === l.valuation?.classification);
                            const lCode = subGradeCodeOf(l.valuation?.standardData) ?? lTier?.short ?? null;
                            return (
                              <tr
                                key={l.id}
                                style={{ borderLeft: isAnchor ? "3px solid var(--brass)" : "3px solid transparent" }}
                              >
                                <td className="px-2 py-2 whitespace-nowrap font-semibold" style={{ color: "var(--text)" }}>
                                  {l.broker || "—"}
                                  {isAnchor && <span className="text-text-muted font-normal"> · came from here</span>}
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
                                {/* Value the sharing here, in the row. */}
                                <td className="px-2 py-1.5 whitespace-nowrap">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      aria-label={`Valuation for ${l.broker ?? "broker"} lot ${l.lotNumber ?? ""}`}
                                      placeholder="—"
                                      disabled={busy}
                                      value={draft}
                                      onChange={(e) =>
                                        setSharingDraft((prev) => ({
                                          ...prev,
                                          [l.id]: sanitizeValuationInput(e.target.value),
                                        }))
                                      }
                                      onKeyDown={(e) => {
                                        if (e.key === "Enter" && dirty && valid) {
                                          e.preventDefault();
                                          saveSharingValue(l, draft);
                                        }
                                      }}
                                      className="w-[92px] px-2 py-1.5 rounded-lg border-2 text-[15px] font-mono font-bold bg-transparent disabled:opacity-50"
                                      style={{
                                        borderColor: !valid
                                          ? "var(--danger)"
                                          : dirty
                                            ? "var(--brass)"
                                            : "var(--border)",
                                        color: "var(--text-strong)",
                                      }}
                                    />
                                    {canCopy && (
                                      <button
                                        type="button"
                                        disabled={busy}
                                        title={`Give this lot the same valuation — Rs. ${typedValuation}`}
                                        onClick={() =>
                                          setSharingDraft((prev) => ({ ...prev, [l.id]: typedValuation }))
                                        }
                                        className="px-2 py-1.5 rounded-lg border text-[12px] font-mono font-bold cursor-pointer touch-manipulation shrink-0"
                                        style={{ borderColor: "var(--border)", color: "var(--text-muted)" }}
                                      >
                                        ={typedValuation}
                                      </button>
                                    )}
                                    {lTier && lCode && (
                                      <span
                                        title={`${lTier.label} · Standard ${lCode}`}
                                        className="px-2 py-1 rounded-full text-[12px] font-bold font-mono shrink-0"
                                        style={{ background: lTier.color, color: "var(--paper-0)" }}
                                      >
                                        {lCode}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="px-2 py-1.5 whitespace-nowrap text-right">
                                  <div className="flex items-center gap-1.5 justify-end">
                                    {dirty && (
                                      <button
                                        type="button"
                                        disabled={busy || !valid}
                                        onClick={() => saveSharingValue(l, draft)}
                                        title="Save this valuation — the tier and Standard follow from it"
                                        className="px-3 py-1.5 rounded-full text-[12.5px] font-bold cursor-pointer touch-manipulation disabled:opacity-40"
                                        style={{ background: "var(--liquor)", color: "var(--paper-0)" }}
                                      >
                                        {busy ? "…" : "Save"}
                                      </button>
                                    )}
                                    <button
                                      type="button"
                                      disabled={busy}
                                      onClick={isAnchor ? () => returnToAnchor() : () => openSharing(l)}
                                      title={
                                        isAnchor
                                          ? "Go back to the lot you came from"
                                          : "Open this lot in full — remarks, photo, voice notes"
                                      }
                                      className="px-3 py-1.5 rounded-full text-[12.5px] font-bold border-2 cursor-pointer touch-manipulation"
                                      style={
                                        isAnchor
                                          ? { background: "var(--liquor)", borderColor: "var(--liquor)", color: "var(--paper-0)" }
                                          : { borderColor: "var(--liquor)", color: "var(--liquor)" }
                                      }
                                    >
                                      {isAnchor ? "↩ Back" : "Open →"}
                                    </button>
                                  </div>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}

                {/* How this same mark + grade fared last sale — status, the actual sold
                    price if it cleared, or the best (registered) bid if it didn't. Read-only:
                    the previous sale's lots aren't this sale's data to edit. */}
                <div className="mt-4 pt-3 border-t border-dashed border-border">
                  <p className="font-mono text-[10px] tracking-widest uppercase text-text-muted font-semibold mb-2">
                    Previous Sale
                  </p>
                  {previousSaleSharings.length === 0 ? (
                    <p className="text-[12.5px] text-text-muted m-0 leading-relaxed">
                      No matching lot for{" "}
                      <strong style={{ color: "var(--text-strong)" }}>{sellingMarkOf(lot) ?? "this mark"}</strong>
                      {lot.grade ? ` · ${lot.grade}` : ""} in the previous sale.
                    </p>
                  ) : (
                    <div className="overflow-x-auto -mx-1 px-1">
                      <table className="w-full border-collapse text-[13px]">
                        <thead>
                          <tr>
                            {["Broker", "Lot", "Wt/Bag", "Status", "Price"].map((h) => (
                              <th
                                key={h}
                                className="font-mono text-[9px] tracking-widest uppercase text-text-muted font-semibold px-2 py-1 text-left whitespace-nowrap"
                              >
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {previousSaleSharings.map((l) => {
                            const sold = purchasedPriceOf(l);
                            const bid = registeredBidOf(l);
                            const wtBag = weightPerChestOf(l);
                            const diffPacking = !!wtBag && !!currentWtBag && wtBag !== currentWtBag;
                            return (
                              <tr key={l.id}>
                                <td className="px-2 py-2 whitespace-nowrap font-semibold" style={{ color: "var(--text)" }}>
                                  {l.broker || "—"}
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap font-mono">{l.lotNumber ?? "—"}</td>
                                <td
                                  className="px-2 py-2 whitespace-nowrap font-mono"
                                  style={diffPacking ? { color: "var(--warn)", fontWeight: 700 } : undefined}
                                  title={diffPacking ? "Different packing from your lot" : undefined}
                                >
                                  {wtBag ?? "—"}
                                  {diffPacking ? " ≠" : ""}
                                </td>
                                <td className="px-2 py-2 whitespace-nowrap">{statusOf(l) ?? "—"}</td>
                                <td
                                  className="px-2 py-2 whitespace-nowrap font-mono font-bold"
                                  style={{ color: sold ? "var(--sage-dark)" : bid ? "var(--warn)" : "var(--text-muted)" }}
                                  title={sold ? "Actual price it sold for" : bid ? "Highest bid registered — didn't sell" : undefined}
                                >
                                  {sold ? `Rs. ${sold}` : bid ? `Bid Rs. ${bid}` : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
                  </div>
                </div>
              </>
            )}
          </Paper>

          {/* Grading block — classification tiers on top, the Standard sub-grade beneath,
              flanked by big tap-friendly previous/next-lot buttons that span both rows.
              Both rows are ALWAYS mounted so the block is a fixed shape: typing a value
              lights it up rather than growing the page under the taster's finger. Reuses
              goTo, so leaving the lot saves everything first exactly like the chevrons do. */}
          <div className="flex items-stretch gap-2 shrink-0">
            <button
              type="button"
              disabled={index === 0 || saving}
              onClick={() => goTo(index - 1)}
              aria-label="Previous lot"
              title="Previous lot"
              className="shrink-0 w-12 sm:w-14 rounded-xl border-2 cursor-pointer touch-manipulation active:scale-[0.97] transition-transform flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              style={{ borderColor: "var(--border)", background: "var(--surface)", color: "var(--text-strong)" }}
            >
              <ChevronLeftIcon sx={{ fontSize: 34 }} />
            </button>

            <div className="flex-1 min-w-0 flex flex-col gap-1">
              <div
                className="grid grid-cols-2 md:grid-cols-4 gap-2 rounded-xl"
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
                      className="min-h-[52px] rounded-lg border-2 cursor-pointer touch-manipulation active:scale-[0.98] transition-transform py-1.5 px-1 disabled:cursor-not-allowed"
                      style={{
                        borderColor: c.color,
                        background: active ? c.color : "var(--surface)",
                        color: active ? "var(--paper-0)" : c.color,
                        opacity: valuePresent ? 1 : 0.4,
                        boxShadow: active ? "var(--shadow-md)" : "none",
                      }}
                    >
                      <span className="block text-[17px] font-bold leading-tight">
                        {active ? "✓ " : ""}
                        {c.label}
                      </span>
                      {/* This tier's record for the lot's grade in the previous sale. */}
                      {gradeStats && (
                        <span className="block text-[12px] font-semibold mt-0.5" style={{ opacity: 0.85 }}>
                          {tierInfo
                            ? `${formatTierRange(tierInfo)} · ${Math.round(tierInfo.percent)}%`
                            : "no lots last sale"}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>

              {/* No coaching line under the tiers. Everything it used to spell out is already
                  on screen for anyone who works this daily: the buttons carry each tier's
                  previous-sale band and share, the selected one carries a ✓, disabled buttons
                  say "not yet", the warn outline on this group says a classification is still
                  owed, and the strip above states the lot's status outright. */}

              {/* Standard sub-grade: the chosen tier's previous-sale band, split into four.
                  Auto-selects with the tier and is the Standard field's only writer. No label
                  line above it — this is a daily-use screen, the four buttons are self-evident
                  from position/shape alone, and the highlighted one (checkmark, filled colour)
                  already says what's picked. */}
              <div className="grid grid-cols-4 gap-2">
                {SUB_GRADE_SUFFIXES.map(({ suffix, label }) => {
                  // With no tier settled, subGradeCode has no prefix to add and returns the
                  // bare suffix — exactly the right placeholder for the dimmed state.
                  const code = subGradeCode(displayCls, suffix);
                  const active = subEnabled && displaySubSuffix === suffix;
                  const band = subTierStats ? subBandRange(subTierStats, suffix) : null;
                  return (
                    <button
                      key={suffix}
                      type="button"
                      disabled={saving || !subEnabled}
                      onClick={() => commitSubGrade(suffix)}
                      title={
                        !subEnabled
                          ? "Enter a valuation and pick a tier — a sub-grade grades the tier's band"
                          : active
                            ? "Tap again to clear the sub-grade"
                            : `Mark Standard as ${code} (${label}${
                                band
                                  ? ` · Rs. ${Math.round(band.lo).toLocaleString()}–${Math.round(band.hi).toLocaleString()}`
                                  : ""
                              })`
                      }
                      className="min-h-[48px] rounded-lg border-2 cursor-pointer touch-manipulation active:scale-[0.98] transition-transform py-1 px-1 disabled:cursor-not-allowed"
                      style={{
                        borderColor: subEnabled ? subColor : "var(--border)",
                        background: active ? subColor : "var(--surface)",
                        color: active ? "var(--paper-0)" : subEnabled ? subColor : "var(--text-muted)",
                        opacity: subEnabled ? 1 : 0.4,
                        boxShadow: active ? "var(--shadow-md)" : "none",
                      }}
                    >
                      <span className="block text-[18px] font-bold leading-tight font-mono">
                        {active ? "✓ " : ""}
                        {code}
                      </span>
                      <span className="block text-[11.5px] font-semibold mt-0.5" style={{ opacity: 0.85 }}>
                        {band
                          ? `Rs. ${Math.round(band.lo).toLocaleString()}–${Math.round(band.hi).toLocaleString()}`
                          : label}
                      </span>
                    </button>
                  );
                })}
              </div>
              {/* Likewise no line under the sub-grades: the "Standard → B+" badge in the
                  header already states exactly what will be saved. */}
            </div>

            <button
              type="button"
              disabled={index + 1 >= total || saving}
              onClick={() => goTo(index + 1)}
              aria-label="Next lot"
              title="Next lot"
              className="shrink-0 w-12 sm:w-14 rounded-xl border-2 cursor-pointer touch-manipulation active:scale-[0.97] transition-transform flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed"
              style={{
                borderColor: "var(--liquor)",
                background: "var(--liquor)",
                color: "var(--paper-0)",
                boxShadow: "var(--shadow-md)",
              }}
            >
              <ChevronRightIcon sx={{ fontSize: 34 }} />
            </button>
          </div>

          {/* entry columns: three remark containers + the calculator on the far right.
              Takes every pixel the grading block above leaves over. */}
          <div
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 flex-1"
            // One row per breakpoint's column count, each at least tall enough for the
            // calculator's own stack (24 padding + 22 header + 98 for the two value lines
            // + 21 feedback + 244 keypad = 409, rounded to 415) and growing to share any
            // leftover height equally. Putting the floor on the ROW rather than the whole
            // grid is what makes it correct at every breakpoint: at 2 columns the grid
            // needs two of those rows, and asking the grid for one 440 total would have
            // squeezed each card to 220 and clipped the keypad.
            style={{ gridAutoRows: "minmax(415px, 1fr)" }}
          >
            {FOCUS_TEXT_FIELDS.map((f) => (
              <Paper
                key={f.value}
                variant="outlined"
                sx={{
                  borderColor: "var(--border)",
                  p: 1.5,
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  boxShadow: "var(--shadow-sm)",
                }}
              >
                <div className="flex items-center gap-2 mb-1.5 shrink-0">
                  <span className="font-mono text-[11px] tracking-widest uppercase text-text-muted font-semibold">
                    {f.label}
                  </span>
                </div>
                {media && (
                  <div className="mb-1.5 shrink-0">
                    <VoiceRecorder
                      lotId={lot.id}
                      field={f.value}
                      has={media.voice.includes(f.value)}
                      version={mediaVersion}
                      onChanged={refreshMedia}
                    />
                  </div>
                )}
                {/* Same share of the card in every column, so the text boxes below line up. */}
                <div className="min-h-0 mb-2" style={{ flex: `${CHIPS_GROW} 1 0` }}>
                  <KeywordChips
                    field={f.value}
                    value={fieldText[f.value]}
                    disabled={saving}
                    fill
                    onToggle={chipHandlers[f.value]}
                  />
                </div>
                <textarea
                  value={fieldText[f.value]}
                  placeholder={f.placeholder}
                  disabled={saving}
                  onChange={(e) => setFieldText((prev) => ({ ...prev, [f.value]: e.target.value }))}
                  className="w-full resize-none bg-transparent border border-border rounded-md px-2.5 py-2 text-[15px] leading-relaxed outline-none min-h-0"
                  style={{ color: "var(--text)", flex: `${TEXT_GROW} 1 0` }}
                />
              </Paper>
            ))}

            {/* calculator container — most right */}
            <Paper
              variant="outlined"
              sx={{
                borderColor: "var(--brass)",
                borderWidth: 2,
                p: 1.5,
                display: "flex",
                flexDirection: "column",
                minHeight: 0,
                boxShadow: "var(--shadow-md)",
              }}
            >
              {/* Short enough to stay on one line in a quarter-width card — the digit cap is
                  enforced by the input itself, so it belongs in the tooltip, not the header. */}
              <div
                className="font-mono text-[11px] tracking-widest uppercase text-text-muted font-semibold mb-1.5 shrink-0 truncate"
                title={`Whole LKR value, up to ${VALUATION_MAX_DIGITS} digits`}
              >
                Valuation (LKR)
              </div>
              {/* Two lines instead of one dash-separated field: fill the first alone for a
                  single value, both for a range. The active line is what the keypad types
                  into, and is outlined so it's obvious which one that is. */}
              {VALUATION_LINES.map(({ line, prefix, label, placeholder }) => {
                const locked = line === "to" && rangeLineLocked;
                const active = activeLine === line && !locked;
                return (
                  <div key={line} className="flex items-center gap-1.5 mb-1 shrink-0">
                    <span
                      className="text-[12.5px] font-mono shrink-0 w-[26px] text-right"
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
                      placeholder={locked ? "value first" : placeholder}
                      title={locked ? "Type the value on the line above first" : undefined}
                      className="w-full min-w-0 px-2.5 py-1.5 rounded-lg border-2 text-[24px] font-mono font-bold bg-transparent tracking-wide disabled:cursor-not-allowed"
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
                          // From a freshly-typed value, Enter moves to the range line first
                          // rather than saving straight away — a range needs that line
                          // reachable by keyboard too, not just the on-screen Range key.
                          // Enter from the range line (or from an empty value line) saves
                          // and advances, same as before.
                          if (line === "from" && !rangeLineLocked) goToLine("to");
                          else saveAndNext();
                        }
                      }}
                    />
                  </div>
                );
              })}
              <div className="h-[17px] mb-1 shrink-0 overflow-hidden">
                {error && <span className="block leading-[16px] text-[12.5px] font-semibold text-danger">{error}</span>}
                {/* Only the part before the em-dash: the shared message ends with "— press
                    Enter to save", which is worth saying in the grid but is just noise
                    beside a Save & Next ⏎ button, and it overran this quarter-width card. */}
                {!error && feedback && feedback.tone !== "none" && (
                  <span
                    title={feedback.message}
                    className="block leading-[16px] text-[12.5px] font-semibold"
                    style={{ color: feedback.tone === "ok" ? "var(--sage-dark)" : "var(--text-muted)" }}
                  >
                    {feedback.tone === "ok" ? "✓ " : ""}
                    {feedback.message.split(" — ")[0]}
                  </span>
                )}
              </div>

              {/* Five equal rows that divide whatever height the card has left, so the keypad
                  stays reachable on a short tablet instead of overflowing a fixed 48px grid. */}
              <div
                className="grid grid-cols-3 gap-1.5 select-none flex-1 min-h-0"
                style={{ gridTemplateRows: "repeat(5, minmax(0, 1fr))" }}
              >
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
                      className={`min-h-[44px] rounded-lg border-2 font-bold font-mono cursor-pointer touch-manipulation active:scale-[0.97] transition-transform disabled:cursor-not-allowed ${
                        isRange ? "text-[13px]" : "text-[22px]"
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
                  className="min-h-[44px] rounded-lg border-2 text-[14px] font-bold cursor-pointer touch-manipulation active:scale-[0.97] transition-transform"
                  style={{ borderColor: "var(--border)", background: "var(--surface-alt)", color: "var(--text-muted)" }}
                >
                  Clear
                </button>
                <button
                  type="button"
                  disabled={saving}
                  onClick={saveAndNext}
                  className="min-h-[44px] col-span-2 rounded-lg text-[16px] font-bold cursor-pointer touch-manipulation active:scale-[0.97] transition-transform"
                  style={{
                    background: "var(--liquor)",
                    color: "var(--paper-0)",
                    boxShadow: "var(--shadow-md)",
                  }}
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
