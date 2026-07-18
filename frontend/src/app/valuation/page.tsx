"use client";

import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import FilterPanel from "@/components/catalogue/FilterPanel";
import ValuationFocus from "@/components/valuation/ValuationFocus";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { CLASSIFICATIONS } from "@/lib/classifications";
import { hasValuation, lotLabel, noOfChestsOf, sellingMarkOf, valuationToText, weightPerChestOf } from "@/lib/lotDisplay";
import {
  filterLots,
  isColumnFilterActive,
  type ColumnFilterState,
  type TicketStatus,
} from "@/lib/lotFilters";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import {
  parseValuationInput,
  sanitizeValuationInput,
  valuationTypingFeedback,
  VALUATION_MAX,
  VALUATION_MIN,
} from "@/lib/valuationInput";
import { STATUS_OPTIONS, type StatusFilter } from "@/lib/valuationFilters";
import {
  effectiveOfParsed,
  effectiveValuationOf,
  formatTierRange,
  gradeStatsFor,
  suggestTier,
  tierStatsFor,
  tierSummary,
} from "@/lib/previousSale";
import type { ClassificationValue, Lot, PreviousGradeStats, ValuationUpdate } from "@/types/api";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import LinearProgress from "@mui/material/LinearProgress";
import MenuItem from "@mui/material/MenuItem";
import Paper from "@mui/material/Paper";
import Select from "@mui/material/Select";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FilterListIcon from "@mui/icons-material/FilterList";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import RadioButtonUncheckedIcon from "@mui/icons-material/RadioButtonUnchecked";
import SearchIcon from "@mui/icons-material/Search";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const PENDING_KEY = "asc:valuation:pending";

type ExtraField = "standardData" | "adjectiveData" | "liquorRemarks" | "musterReport" | "brokerNotes" | "privateNotes";

type RowField = "valuation" | "classification" | ExtraField;

const EXTRA_FIELDS: { value: ExtraField; label: string }[] = [
  { value: "liquorRemarks", label: "Taster's Remarks" },
  { value: "standardData", label: "Standard Data" },
  { value: "adjectiveData", label: "Adjective Data" },
  { value: "musterReport", label: "Muster Report" },
  { value: "brokerNotes", label: "Broker Notes" },
  { value: "privateNotes", label: "Private Notes" },
];

const isClassified = (lot: Lot) => (lot.valuation?.classification ?? "Unclassified") !== "Unclassified";

export default function ValuationCentrePage() {
  const router = useRouter();
  const { activeCatalogueId, activeCatalogue } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  const [handoffIds, setHandoffIds] = useState<Set<string>>(new Set());
  const [values, setValues] = useState<Record<string, string>>({});
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  // Optional extra columns ("Also fill") worked in the same pass as the valuation.
  const [extraOn, setExtraOn] = useState<Set<ExtraField>>(new Set());
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  // Lot currently blocked from advancing because its classification is still unset.
  const [clsNeededId, setClsNeededId] = useState<string | null>(null);
  // Arrow-key highlight inside the focused classification chip group (one group at a time).
  const [clsCursor, setClsCursor] = useState<{ lotId: string; index: number } | null>(null);
  // Per-grade classification history from the previous sale — drives auto-classification.
  const [prevStats, setPrevStats] = useState<PreviousGradeStats | null>(null);
  // Lots whose current classification was auto-picked from the previous sale (labels the hint).
  const [autoClsIds, setAutoClsIds] = useState<Set<string>>(new Set());
  // Lot whose auto-classification found no previous-sale data for its grade.
  const [noPrevDataId, setNoPrevDataId] = useState<string | null>(null);
  // Tier chip under the mouse — previews that tier's previous-sale values.
  const [clsHover, setClsHover] = useState<{ lotId: string; tier: ClassificationValue } | null>(null);
  // Row whose valuation input has focus — that row shows its grade's previous-sale band strip.
  const [activeValLotId, setActiveValLotId] = useState<string | null>(null);
  // List filters — focus-mode navigation walks the filtered list too. Column filters,
  // ticket status and classification use the exact same engine as Catalogue Manager.
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterState>>({});
  const [ticketStatusFilter, setTicketStatusFilter] = useState<TicketStatus | "">("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Focus mode: one lot on screen with the tablet keypad; null = normal list view.
  const [focusLotId, setFocusLotId] = useState<string | null>(null);

  // Reset all filters whenever the active catalogue changes — its columns differ.
  const catalogueId = activeCatalogue?.id;
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearch("");
    setStatusFilter("all");
    setColumnFilters({});
    setTicketStatusFilter("");
    setClassificationFilter("");
    setYearFilter("");
    setAutoClsIds(new Set());
    setNoPrevDataId(null);
  }, [catalogueId]);
  const inputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const clsRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const extraRefs = useRef<Record<string, HTMLInputElement | null>>({});

  useEffect(() => {
    // Data-fetch-on-dependency-change effect (clears lots synchronously for the no-catalogue
    // case before its async fetch), not the derived-state anti-pattern the rule targets.
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLots([]);
      return;
    }
    setLoading(true);
    api
      .getLots(activeCatalogueId, { pageSize: 20000 })
      .then((paged) => setLots(paged.rows))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  // Previous-sale classification history for auto-classification. Best-effort: without
  // it the page simply falls back to fully manual classification.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPrevStats(null);
    if (!activeCatalogueId) return;
    let cancelled = false;
    api
      .getPreviousGradeStats(activeCatalogueId)
      .then((s) => {
        if (!cancelled) setPrevStats(s);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeCatalogueId]);

  // Consume a one-shot handoff from the Catalogue Manager's "Valuation…" button — any lots
  // selected there get added to this page's working set alongside whatever's already valued.
  useEffect(() => {
    if (!activeCatalogueId || lots.length === 0) return;
    const raw = window.sessionStorage.getItem(PENDING_KEY);
    if (!raw) return;
    window.sessionStorage.removeItem(PENDING_KEY);
    try {
      const pending = JSON.parse(raw) as { catalogueId: string; lotIds: string[] };
      if (pending.catalogueId !== activeCatalogueId) return;
      const validIds = pending.lotIds.filter((id) => lots.some((l) => l.id === id));
      if (validIds.length === 0) return;
      // One-shot handoff consumed inside an effect by design — not derived state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHandoffIds((prev) => new Set([...prev, ...validIds]));
    } catch {
      // ignore malformed handoff payload
    }
  }, [activeCatalogueId, lots]);

  // The working set is everything already valued, plus anything just handed off from the
  // Catalogue Manager that still needs a value — in the catalogue's natural (lot) order.
  const displayedLots = useMemo(
    () => lots.filter((l) => hasValuation(l) || handoffIds.has(l.id)),
    [lots, handoffIds]
  );

  // The list actually on screen — universal search (every raw column), per-column
  // filters, ticket status, classification and valuation progress all applied. Keyboard
  // navigation and focus mode both walk this filtered list.
  const visibleLots = useMemo(() => {
    const base = filterLots(displayedLots, {
      search,
      columnFilters,
      status: ticketStatusFilter,
      classification: classificationFilter,
      year: yearFilter,
    });
    if (statusFilter === "all") return base;
    return base.filter((l) => {
      const valued = hasValuation(l);
      const classified = isClassified(l);
      if (statusFilter === "pending") return !(valued && classified);
      if (statusFilter === "unvalued") return !valued;
      if (statusFilter === "needs-classification") return valued && !classified;
      return valued && classified; // complete
    });
  }, [displayedLots, search, statusFilter, columnFilters, ticketStatusFilter, classificationFilter, yearFilter]);

  const columnFilterCount =
    Object.values(columnFilters).filter(isColumnFilterActive).length +
    (ticketStatusFilter ? 1 : 0) +
    (classificationFilter ? 1 : 0) +
    (yearFilter ? 1 : 0);
  const filtersActive = search.trim() !== "" || statusFilter !== "all" || columnFilterCount > 0;

  const clearAllFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setColumnFilters({});
    setTicketStatusFilter("");
    setClassificationFilter("");
    setYearFilter("");
  };

  // Sync a lot saved from focus mode back into everything the list view derives from.
  const applyUpdatedLot = (updated: Lot) => {
    setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setValues((v) => ({ ...v, [updated.id]: valuationToText(updated) }));
    setSavedIds((prev) => {
      const next = new Set(prev);
      if (hasValuation(updated)) next.add(updated.id);
      else next.delete(updated.id);
      return next;
    });
    setExtraValues((prev) => {
      const next = { ...prev };
      EXTRA_FIELDS.forEach((f) => {
        const key = `${f.value}:${updated.id}`;
        if (next[key] !== undefined) next[key] = updated.valuation?.[f.value] ?? "";
      });
      return next;
    });
  };

  // Seed the text field for any newly-displayed lot without clobbering one the user is
  // already mid-edit on — an additive merge, not a full derive, so an effect is the right tool.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      displayedLots.forEach((l) => {
        if (next[l.id] === undefined) {
          next[l.id] = valuationToText(l);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
    setSavedIds((prev) => {
      let changed = false;
      const next = new Set(prev);
      displayedLots.forEach((l) => {
        if (hasValuation(l) && !next.has(l.id)) {
          next.add(l.id);
          changed = true;
        }
      });
      return changed ? next : prev;
    });
  }, [displayedLots]);

  const enabledExtras = useMemo(() => EXTRA_FIELDS.filter((f) => extraOn.has(f.value)), [extraOn]);

  // Same additive seeding for any newly-enabled extra column.
  useEffect(() => {
    if (enabledExtras.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExtraValues((prev) => {
      let changed = false;
      const next = { ...prev };
      displayedLots.forEach((l) => {
        enabledExtras.forEach((f) => {
          const key = `${f.value}:${l.id}`;
          if (next[key] === undefined) {
            next[key] = l.valuation?.[f.value] ?? "";
            changed = true;
          }
        });
      });
      return changed ? next : prev;
    });
  }, [displayedLots, enabledExtras]);

  // Left-to-right field order within a row — the arrow-key navigation grid's columns.
  const rowFields = useMemo<RowField[]>(
    () => ["valuation", "classification", ...enabledExtras.map((f) => f.value)],
    [enabledExtras]
  );

  const focusField = (index: number, field: RowField) => {
    const lot = visibleLots[index];
    if (!lot) return;
    if (field === "valuation") inputRefs.current[lot.id]?.focus();
    else if (field === "classification") clsRefs.current[lot.id]?.focus();
    else extraRefs.current[`${field}:${lot.id}`]?.focus();
  };

  const focusRow = (index: number) => focusField(index, "valuation");

  // Move focus to the next step in the row flow: valuation → classification → extras → next lot.
  // Classification is the gate — focus never reaches the next lot while this one is unclassified.
  const advance = (lot: Lot, index: number, from: "valuation" | "classification" | ExtraField) => {
    if (!isClassified(lot)) {
      setClsNeededId(lot.id);
      clsRefs.current[lot.id]?.focus();
      return;
    }
    const order = enabledExtras.map((f) => f.value);
    const pos = from === "valuation" || from === "classification" ? 0 : order.indexOf(from) + 1;
    const nextField = order[pos];
    if (nextField) extraRefs.current[`${nextField}:${lot.id}`]?.focus();
    else focusRow(index + 1);
  };

  // Parse and save the typed value when it differs from what's stored. While the tier is
  // unset (or was itself auto-picked), the previous sale's suggested classification for
  // the new value rides along in the same call — a hand-picked tier is never touched.
  // Returns the lot to continue navigating with (updated, or as-is when nothing changed),
  // or null when the input is invalid or the save failed — callers keep focus in place on null.
  const saveValuation = async (lot: Lot): Promise<Lot | null> => {
    const text = values[lot.id] ?? "";
    if (text === valuationToText(lot)) return lot;
    const parsed = parseValuationInput(text);
    setErrors((e) => {
      const next = { ...e };
      delete next[lot.id];
      return next;
    });

    if (parsed.kind === "error") {
      setErrors((e) => ({ ...e, [lot.id]: parsed.message }));
      return null;
    }

    const patch: Partial<ValuationUpdate> =
      parsed.kind === "clear"
        ? { valuationSingle: null, valuationFrom: null, valuationTo: null }
        : parsed.kind === "single"
          ? { valuationSingle: parsed.value, valuationFrom: null, valuationTo: null }
          : { valuationSingle: null, valuationFrom: parsed.from, valuationTo: parsed.to };

    const currentCls = lot.valuation?.classification ?? "Unclassified";
    let autoTier: ClassificationValue | null = null;
    if (currentCls === "Unclassified" || autoClsIds.has(lot.id)) {
      const stats = gradeStatsFor(prevStats, lot.grade);
      const liveValue = effectiveOfParsed(parsed);
      autoTier = stats && liveValue !== null ? suggestTier(stats, liveValue) : null;
      if (autoTier) patch.classification = autoTier;
      // The value is gone — an auto-picked tier goes with it (hand-picked ones stay).
      else if (parsed.kind === "clear" && autoClsIds.has(lot.id)) patch.classification = "Unclassified";
    }

    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setSavedIds((s) => {
        const next = new Set(s);
        if (parsed.kind === "clear") next.delete(lot.id);
        else next.add(lot.id);
        return next;
      });
      setAutoClsIds((prev) => {
        if (!!autoTier === prev.has(lot.id)) return prev;
        const next = new Set(prev);
        if (autoTier) next.add(lot.id);
        else next.delete(lot.id);
        return next;
      });
      return updated;
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return null;
    } finally {
      setSavingId(null);
    }
  };

  // Auto-pick a classification from the previous sale's record for this lot's grade.
  // Returns the updated lot, or null when there's no usable history (callers fall back
  // to the manual classification gate).
  const autoClassify = async (lot: Lot): Promise<Lot | null> => {
    const stats = gradeStatsFor(prevStats, lot.grade);
    const value = effectiveValuationOf(lot);
    const tier = stats && value !== null ? suggestTier(stats, value) : null;
    if (!tier) {
      setNoPrevDataId(lot.id);
      return null;
    }
    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { classification: tier }));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      setAutoClsIds((prev) => new Set(prev).add(lot.id));
      setNoPrevDataId((id) => (id === lot.id ? null : id));
      return updated;
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return null;
    } finally {
      setSavingId(null);
    }
  };

  const commit = async (lot: Lot, index: number) => {
    const updated = await saveValuation(lot);
    if (!updated) return;
    // A cleared/blank row is being abandoned, so no classification gate applies.
    if (!hasValuation(updated)) {
      focusRow(index + 1);
      return;
    }
    // Fresh valuation on an unclassified lot: auto-select the tier the previous sale
    // suggests, then hold focus on the chips so Enter accepts it or the user overrides.
    if (!isClassified(updated)) {
      const auto = await autoClassify(updated);
      if (auto) {
        const at = CLASSIFICATIONS.findIndex((c) => c.value === auto.valuation?.classification);
        clsRefs.current[auto.id]?.focus();
        setClsCursor({ lotId: auto.id, index: Math.max(0, at) });
        return;
      }
    }
    advance(updated, index, "valuation");
  };

  // Classification saves instantly on click — clicking the active tier again clears it.
  const commitClassification = async (lot: Lot, index: number, value: ClassificationValue) => {
    const current = lot.valuation?.classification ?? "Unclassified";
    const next: ClassificationValue = current === value ? "Unclassified" : value;
    setSavingId(lot.id);
    let updated: Lot;
    try {
      updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { classification: next }));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      // A hand-picked tier is an override — drop the "auto-selected" label and no-data note.
      setAutoClsIds((prev) => {
        if (!prev.has(lot.id)) return prev;
        const n = new Set(prev);
        n.delete(lot.id);
        return n;
      });
      setNoPrevDataId((id) => (id === lot.id ? null : id));
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return;
    } finally {
      setSavingId(null);
    }
    if (next !== "Unclassified") {
      setClsNeededId((id) => (id === lot.id ? null : id));
      advance(updated, index, "classification");
    }
  };

  // Same contract as saveValuation: skips the API call when nothing changed, null on failure.
  const saveExtra = async (lot: Lot, field: ExtraField): Promise<Lot | null> => {
    const raw = (extraValues[`${field}:${lot.id}`] ?? "").trim();
    if (raw === (lot.valuation?.[field] ?? "").trim()) return lot;
    setSavingId(lot.id);
    try {
      const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { [field]: raw === "" ? null : raw }));
      setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
      return updated;
    } catch {
      setErrors((e) => ({ ...e, [lot.id]: "Save failed — try again" }));
      return null;
    } finally {
      setSavingId(null);
    }
  };

  const commitExtra = async (lot: Lot, index: number, field: ExtraField) => {
    const updated = await saveExtra(lot, field);
    if (updated) advance(updated, index, field);
  };

  // A lot only counts as done once it has both a valuation and a classification.
  const filledCount = displayedLots.filter((l) => savedIds.has(l.id) && isClassified(l)).length;

  // Resolve the focused lot. Navigation walks the filtered list; if the focused lot has
  // dropped out of the current filter mid-edit, fall back to the full working list so the
  // focus view doesn't vanish under the user.
  let focusList = visibleLots;
  let focusIndex = focusLotId ? visibleLots.findIndex((l) => l.id === focusLotId) : -1;
  if (focusLotId && focusIndex === -1) {
    focusList = displayedLots;
    focusIndex = displayedLots.findIndex((l) => l.id === focusLotId);
  }
  const focusLot = focusIndex >= 0 ? focusList[focusIndex] : null;

  // While in focus mode, searching/filtering jumps to the first matching lot as soon as
  // the current one no longer matches — that's how the universal search "goes to" a row.
  const focusOutOfFilter = !!focusLotId && visibleLots.length > 0 && !visibleLots.some((l) => l.id === focusLotId);
  const firstVisibleId = visibleLots[0]?.id;
  useEffect(() => {
    if (!focusOutOfFilter || !firstVisibleId) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setFocusLotId(firstVisibleId);
  }, [focusOutOfFilter, firstVisibleId]);

  const enterFocus = () => {
    // Start from the first lot that still needs something, else from the top.
    const target = visibleLots.find((l) => !(hasValuation(l) && isClassified(l))) ?? visibleLots[0];
    if (target) setFocusLotId(target.id);
  };

  if (!activeCatalogueId) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Valuation Centre</h1>
        <p className="text-[13px] text-text-muted">Load a catalogue from Catalogue Manager first.</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Valuation Centre</h1>
          <p className="text-[13px] text-text-muted m-0">
            {activeCatalogue?.sourceName} · {displayedLots.length.toLocaleString()} lot{displayedLots.length === 1 ? "" : "s"} ·
            values in <strong>LKR</strong>
          </p>
        </div>
        <div className="flex gap-2">
          {!focusLot && displayedLots.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<CenterFocusStrongIcon fontSize="small" />}
              onClick={enterFocus}
              disabled={visibleLots.length === 0}
            >
              Focus mode
            </Button>
          )}
          {activeCatalogueId && displayedLots.length > 0 && (
            <ExportShareMenu catalogueId={activeCatalogueId} catalogueName={activeCatalogue?.sourceName ?? "Catalogue"} lots={displayedLots} />
          )}
          <Button
            variant="contained"
            size="small"
            startIcon={<AddCircleOutlineIcon fontSize="small" />}
            onClick={() => router.push("/catalogue")}
          >
            Add more lots
          </Button>
        </div>
      </div>

      {loading && <p className="text-text-muted text-sm mt-4">Loading lots…</p>}

      {!loading && displayedLots.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">No lots valued yet</h3>
          <p className="mb-4">Go to Catalogue Manager, select the lots you want to value, then use its &ldquo;Valuation…&rdquo; button.</p>
          <Button
            variant="contained"
            color="primary"
            startIcon={<AddCircleOutlineIcon fontSize="small" />}
            onClick={() => router.push("/catalogue")}
          >
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {!loading && focusLot && (
        <ValuationFocus
          lot={focusLot}
          gradeStats={gradeStatsFor(prevStats, focusLot.grade)}
          index={focusIndex}
          total={focusList.length}
          filters={{
            search,
            setSearch,
            statusFilter,
            setStatusFilter,
            headers: activeCatalogue?.headers ?? [],
            columnMeta: activeCatalogue?.columnMeta ?? {},
            lots: displayedLots,
            columnFilters,
            onColumnFilterChange: (h, v) => setColumnFilters((prev) => ({ ...prev, [h]: v })),
            ticketStatus: ticketStatusFilter,
            setTicketStatus: setTicketStatusFilter,
            classification: classificationFilter,
            setClassification: setClassificationFilter,
            year: yearFilter,
            setYear: setYearFilter,
            columnFilterCount,
            onClearAll: clearAllFilters,
            matchLots: visibleLots,
          }}
          onJump={(id) => setFocusLotId(id)}
          onNavigate={(i) => {
            const next = focusList[i];
            if (next) setFocusLotId(next.id);
          }}
          onExit={() => setFocusLotId(null)}
          onLotUpdated={applyUpdatedLot}
        />
      )}

      {!loading && !focusLot && displayedLots.length > 0 && (
        <div className="mt-3">
          <div className="flex items-center gap-3 mb-2">
            <span className="text-[12.5px] text-text-muted font-mono">
              {filledCount} / {displayedLots.length} filled
            </span>
            <LinearProgress
              variant="determinate"
              value={(filledCount / Math.max(displayedLots.length, 1)) * 100}
              sx={{ flex: 1, height: 6, borderRadius: 3 }}
            />
          </div>
          <p className="text-[12px] text-text-muted mb-2">
            Type a single value (e.g. <span className="font-mono">1250</span>) or a range (e.g.{" "}
            <span className="font-mono">1200-1350</span>) — it&apos;s detected automatically. Valuations are whole
            values from <span className="font-mono">{VALUATION_MIN}</span> to <span className="font-mono">{VALUATION_MAX}</span>,
            and in a range the first number must be lower than the second (the field only accepts digits and a dash).
            As soon as the value is valid, the classification{" "}
            <strong>auto-selects from the previous sale&apos;s record for that grade</strong>, with a note showing the
            grade&apos;s previous values for that tier (hover or highlight any tier to see its own). Press{" "}
            <strong>Enter</strong> and the value and classification save together — you jump straight to the next lot.
            Override any time: press <span className="font-mono">1</span>–<span className="font-mono">4</span>, click a
            tier, or highlight one with <span className="font-mono">←</span>/<span className="font-mono">→</span> and{" "}
            <strong>Enter</strong>. A grade with no previous-sale history still needs a manual classification. The arrow keys move freely around the grid — <span className="font-mono">↑</span>/
            <span className="font-mono">↓</span> between lots, <span className="font-mono">←</span>/
            <span className="font-mono">→</span> across a row&apos;s fields — and anything you&apos;ve typed is saved on the
            way out. Leave blank + Enter to clear a valuation. On a tablet, use <strong>Focus mode</strong> (or the{" "}
            <OpenInFullIcon sx={{ fontSize: 12, verticalAlign: "middle" }} /> button on a row) to work one lot at a time
            with an on-screen keypad — the filters below choose which lots it walks through.
          </p>
          <div className="flex items-center gap-2 flex-wrap mb-3">
            <TextField
              size="small"
              placeholder="Search any lot data — lot no, mark, grade, any column…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 250 }}
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
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
              sx={{ minWidth: 190, fontSize: 13 }}
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
              Filters{columnFilterCount > 0 ? ` (${columnFilterCount})` : ""}
            </Button>
            {filtersActive && (
              <>
                <span className="text-[12px] text-text-muted">
                  {visibleLots.length.toLocaleString()} of {displayedLots.length.toLocaleString()} lots shown
                </span>
                <Button size="small" onClick={clearAllFilters}>
                  Clear filters
                </Button>
              </>
            )}
          </div>

          {filtersOpen && activeCatalogue && (
            <FilterPanel
              headers={activeCatalogue.headers}
              columnMeta={activeCatalogue.columnMeta}
              lots={displayedLots}
              columnFilters={columnFilters}
              onColumnFilterChange={(h, v) => setColumnFilters((prev) => ({ ...prev, [h]: v }))}
              status={ticketStatusFilter}
              onStatusChange={setTicketStatusFilter}
              classification={classificationFilter}
              onClassificationChange={setClassificationFilter}
              year={yearFilter}
              onYearChange={setYearFilter}
              onClearAll={clearAllFilters}
            />
          )}

          <div className="flex items-center gap-1.5 flex-wrap mb-3">
            <span className="text-[11px] text-text-muted font-semibold uppercase tracking-wide mr-1">
              Also fill while valuing:
            </span>
            {EXTRA_FIELDS.map((f) => {
              const on = extraOn.has(f.value);
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() =>
                    setExtraOn((prev) => {
                      const next = new Set(prev);
                      if (on) next.delete(f.value);
                      else next.add(f.value);
                      return next;
                    })
                  }
                  title={on ? `Hide the ${f.label} column` : `Add a ${f.label} column to the table`}
                  className="px-2.5 py-1 rounded-full text-[11px] font-semibold border-[1.5px] cursor-pointer whitespace-nowrap"
                  style={{
                    borderColor: on ? "var(--liquor)" : "var(--border)",
                    background: on ? "var(--liquor)" : "transparent",
                    color: on ? "var(--paper-0)" : "var(--text-muted)",
                  }}
                >
                  {f.label}
                </button>
              );
            })}
          </div>

          {visibleLots.length === 0 && (
            <div className="text-center py-12 text-text-muted border border-border rounded-md bg-surface">
              <h3 className="font-display text-lg text-text mb-1">No lots match these filters</h3>
              <p className="m-0 text-[13px]">Adjust the search or status filter above, or clear the filters.</p>
            </div>
          )}

          {visibleLots.length > 0 && (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{ maxHeight: "68vh", borderColor: "var(--border)" }}
          >
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {[
                    "#",
                    "Lot",
                    "Selling Mark",
                    "Bags",
                    "Wt/Bag (kg)",
                    "Valuation (LKR)",
                    "Classification",
                    ...enabledExtras.map((f) => f.label),
                    "Status",
                    "",
                  ].map(
                    (h) => (
                      <TableCell
                        key={h}
                        sx={{
                          bgcolor: "var(--liquor)",
                          color: "var(--paper-0)",
                          fontWeight: 700,
                          fontSize: 11.5,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {h}
                      </TableCell>
                    )
                  )}
                </TableRow>
              </TableHead>
              <TableBody>
                {visibleLots.map((lot, index) => {
                  const saved = savedIds.has(lot.id);
                  const classified = isClassified(lot);
                  const complete = saved && classified;
                  const clsNeeded = clsNeededId === lot.id && !classified;
                  const error = errors[lot.id];
                  const currentCls = lot.valuation?.classification ?? "Unclassified";
                  const text = values[lot.id] ?? "";
                  // Live feedback only while the text differs from what's already saved —
                  // settled rows stay quiet.
                  const feedback = !error && text !== valuationToText(lot) ? valuationTypingFeedback(text) : null;
                  // Previous-sale context for this grade. While the typed value is valid and
                  // the tier isn't hand-picked, the previous sale's suggestion previews as
                  // selected — it will be saved together with the value. Hover / arrow
                  // highlight preview other tiers' history.
                  const gradeStats = gradeStatsFor(prevStats, lot.grade);
                  const wasAuto = autoClsIds.has(lot.id);
                  const liveParsed = text !== valuationToText(lot) ? parseValuationInput(text) : null;
                  const liveValue = liveParsed ? effectiveOfParsed(liveParsed) : null;
                  const mayAuto = currentCls === "Unclassified" || wasAuto;
                  const liveTier =
                    mayAuto && liveValue !== null && gradeStats ? suggestTier(gradeStats, liveValue) : null;
                  const displayCls = liveTier ?? currentCls;
                  const previewTier: ClassificationValue | null =
                    clsHover?.lotId === lot.id
                      ? clsHover.tier
                      : clsCursor?.lotId === lot.id
                        ? (CLASSIFICATIONS[clsCursor.index]?.value ?? null)
                        : (liveTier ?? (wasAuto && currentCls !== "Unclassified" ? currentCls : null));
                  let prevMsg: string | null = null;
                  let prevMsgColor = "var(--text-muted)";
                  if (previewTier) {
                    const tierLabel = CLASSIFICATIONS.find((c) => c.value === previewTier)?.label ?? previewTier;
                    prevMsg = gradeStats
                      ? (tierSummary(lot.grade, gradeStats, previewTier) ??
                        `${gradeStats.saleName}: no ${lot.grade ?? ""} lots were ${tierLabel}`)
                      : `No previous-sale data for ${lot.grade ?? "this grade"}`;
                    if (liveTier && previewTier === liveTier) {
                      prevMsg = `Auto-selects on save — ${prevMsg}`;
                      prevMsgColor = "var(--sage-dark)";
                    } else if (wasAuto && previewTier === currentCls) {
                      prevMsg = `Auto-selected — ${prevMsg}`;
                      prevMsgColor = "var(--sage-dark)";
                    }
                  } else if (mayAuto && liveValue !== null && !gradeStats) {
                    prevMsg = `No previous-sale data for ${lot.grade ?? "this grade"} — pick a tier manually`;
                  } else if (noPrevDataId === lot.id && !classified) {
                    prevMsg = `No previous-sale data for ${lot.grade ?? "this grade"} — pick a tier manually`;
                  }
                  // While this row is being worked, show how the previous sale split this
                  // grade across the four tiers (range + share per tier).
                  const rowActive =
                    activeValLotId === lot.id ||
                    clsCursor?.lotId === lot.id ||
                    clsHover?.lotId === lot.id ||
                    clsNeededId === lot.id ||
                    liveTier !== null;
                  return (
                    <TableRow
                      key={lot.id}
                      hover
                      sx={{
                        "&:nth-of-type(even)": { bgcolor: "var(--surface-alt)" },
                        ...(error && { outline: "1.5px solid var(--danger)", outlineOffset: "-1.5px" }),
                        ...(complete && !error && { borderLeft: "3px solid var(--sage)" }),
                      }}
                    >
                      <TableCell sx={{ fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-muted)" }}>
                        {index + 1}
                      </TableCell>
                      <TableCell sx={{ fontSize: 13, fontWeight: 600 }}>{lotLabel(lot)}</TableCell>
                      <TableCell sx={{ fontSize: 12.5 }}>{sellingMarkOf(lot) ?? "—"}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{noOfChestsOf(lot) ?? "—"}</TableCell>
                      <TableCell sx={{ fontSize: 12.5, fontFamily: "var(--font-mono)" }}>{weightPerChestOf(lot) ?? "—"}</TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1.5">
                          <span className="text-[11px] text-text-muted font-mono shrink-0">Rs.</span>
                          <input
                            ref={(el) => {
                              inputRefs.current[lot.id] = el;
                            }}
                            type="text"
                            inputMode="numeric"
                            placeholder="1250 or 1200-1350"
                            className="w-[160px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent font-mono"
                            style={{ borderColor: error ? "var(--danger)" : "var(--border)", color: "var(--text)" }}
                            value={text}
                            disabled={savingId === lot.id}
                            onFocus={() => setActiveValLotId(lot.id)}
                            onBlur={() => setActiveValLotId((id) => (id === lot.id ? null : id))}
                            onChange={(e) =>
                              setValues((v) => ({ ...v, [lot.id]: sanitizeValuationInput(e.target.value) }))
                            }
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commit(lot, index);
                                return;
                              }
                              // Arrow navigation: ↑/↓ move between lots, →/← move across the row's
                              // fields once the caret is at the value's edge. Any typed value is
                              // saved on the way out; invalid input shows its error and stays put.
                              const el = e.currentTarget;
                              const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
                              const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
                              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                e.preventDefault();
                                const target = e.key === "ArrowUp" ? index - 1 : index + 1;
                                saveValuation(lot).then((ok) => {
                                  if (ok) focusField(target, "valuation");
                                });
                              } else if (e.key === "ArrowRight" && atEnd) {
                                e.preventDefault();
                                saveValuation(lot).then((ok) => {
                                  if (ok) focusField(index, "classification");
                                });
                              } else if (e.key === "ArrowLeft" && atStart && index > 0) {
                                e.preventDefault();
                                saveValuation(lot).then((ok) => {
                                  if (ok) focusField(index - 1, rowFields[rowFields.length - 1]);
                                });
                              }
                            }}
                          />
                        </div>
                        {error && <span className="text-[10.5px] text-danger block mt-0.5">{error}</span>}
                        {feedback && feedback.tone !== "none" && (
                          <span
                            className="text-[10.5px] block mt-0.5"
                            style={{ color: feedback.tone === "ok" ? "var(--sage-dark)" : "var(--text-muted)" }}
                          >
                            {feedback.tone === "ok" ? "✓ " : ""}
                            {feedback.message}
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div
                          ref={(el) => {
                            clsRefs.current[lot.id] = el;
                          }}
                          tabIndex={0}
                          onFocus={() => {
                            if (clsCursor?.lotId !== lot.id) {
                              const at = CLASSIFICATIONS.findIndex((c) => c.value === currentCls);
                              setClsCursor({ lotId: lot.id, index: at === -1 ? 0 : at });
                            }
                          }}
                          onBlur={(e) => {
                            if (!e.currentTarget.contains(e.relatedTarget as Node)) setClsCursor(null);
                          }}
                          onKeyDown={(e) => {
                            const match = CLASSIFICATIONS.find((c) => c.key === e.key);
                            if (match) {
                              e.preventDefault();
                              commitClassification(lot, index, match.value);
                              return;
                            }
                            const cursor =
                              clsCursor?.lotId === lot.id
                                ? clsCursor.index
                                : Math.max(0, CLASSIFICATIONS.findIndex((c) => c.value === currentCls));
                            if (e.key === "ArrowRight") {
                              e.preventDefault();
                              // → past the last tier continues to the next field in the row
                              // (first extra column), or on to the next lot's value.
                              if (cursor === CLASSIFICATIONS.length - 1) {
                                const nextField = rowFields[rowFields.indexOf("classification") + 1];
                                if (nextField) focusField(index, nextField);
                                else focusField(index + 1, "valuation");
                              } else setClsCursor({ lotId: lot.id, index: cursor + 1 });
                            } else if (e.key === "ArrowLeft") {
                              e.preventDefault();
                              // ← past the first tier returns to the valuation input.
                              if (cursor === 0) focusField(index, "valuation");
                              else setClsCursor({ lotId: lot.id, index: cursor - 1 });
                            } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                              e.preventDefault();
                              focusField(e.key === "ArrowUp" ? index - 1 : index + 1, "classification");
                            } else if (e.key === "Enter") {
                              e.preventDefault();
                              const c = CLASSIFICATIONS[cursor];
                              // Enter on the already-set tier just moves on — no toggle-off.
                              if (currentCls === c.value) advance(lot, index, "classification");
                              else commitClassification(lot, index, c.value);
                            }
                          }}
                          className="flex gap-1 flex-wrap rounded-lg outline-none"
                          style={clsNeeded ? { outline: "1.5px solid var(--warn)", outlineOffset: 2 } : undefined}
                        >
                          {CLASSIFICATIONS.map((c, ci) => {
                            const highlighted = clsCursor?.lotId === lot.id && clsCursor.index === ci;
                            const tierInfo = tierStatsFor(gradeStats, c.value);
                            return (
                              <button
                                key={c.value}
                                type="button"
                                tabIndex={-1}
                                disabled={savingId === lot.id}
                                onClick={() => commitClassification(lot, index, c.value)}
                                onMouseEnter={() => setClsHover({ lotId: lot.id, tier: c.value })}
                                onMouseLeave={() =>
                                  setClsHover((h) => (h?.lotId === lot.id && h.tier === c.value ? null : h))
                                }
                                title={
                                  (currentCls === c.value ? "Click again to unset" : `Mark as ${c.label} (press ${c.key})`) +
                                  (tierInfo && gradeStats
                                    ? ` — ${gradeStats.saleName}: ${formatTierRange(tierInfo)} (${Math.round(tierInfo.percent)}%)`
                                    : "")
                                }
                                className="px-2 py-0.5 rounded-full text-[10.5px] font-semibold border-[1.5px] cursor-pointer whitespace-nowrap"
                                style={{
                                  borderColor: displayCls === c.value ? c.color : "var(--border)",
                                  background: displayCls === c.value ? c.color : "transparent",
                                  color: displayCls === c.value ? "var(--paper-0)" : "var(--text-muted)",
                                  ...(highlighted && { boxShadow: `0 0 0 2px ${c.color}` }),
                                }}
                              >
                                {c.label}
                              </button>
                            );
                          })}
                        </div>
                        {rowActive && gradeStats && (
                          <div className="flex items-center gap-x-2 gap-y-0.5 flex-wrap mt-1">
                            <span className="text-[10px] text-text-muted font-mono whitespace-nowrap">
                              {gradeStats.saleName} · {lot.grade}:
                            </span>
                            {CLASSIFICATIONS.map((c) => {
                              const t = tierStatsFor(gradeStats, c.value);
                              if (!t) return null;
                              return (
                                <span
                                  key={c.value}
                                  className="text-[10px] font-mono font-semibold whitespace-nowrap"
                                  style={{ color: c.color }}
                                >
                                  {c.short} {formatTierRange(t, false)} ({Math.round(t.percent)}%)
                                </span>
                              );
                            })}
                          </div>
                        )}
                        {prevMsg && (
                          <span className="text-[10.5px] block mt-1" style={{ color: prevMsgColor }}>
                            {prevMsg}
                          </span>
                        )}
                        {clsNeeded && (
                          <span className="text-[10.5px] block mt-1" style={{ color: "var(--warn)" }}>
                            Classification required — ←/→ then Enter, press 1–4, or click a tier to move on
                          </span>
                        )}
                      </TableCell>
                      {enabledExtras.map((f) => (
                        <TableCell key={f.value}>
                          <input
                            ref={(el) => {
                              extraRefs.current[`${f.value}:${lot.id}`] = el;
                            }}
                            type="text"
                            placeholder={f.label}
                            className="w-[200px] px-2.5 py-1.5 rounded border text-[13px] bg-transparent"
                            style={{ borderColor: "var(--border)", color: "var(--text)" }}
                            value={extraValues[`${f.value}:${lot.id}`] ?? ""}
                            disabled={savingId === lot.id}
                            onChange={(e) => setExtraValues((v) => ({ ...v, [`${f.value}:${lot.id}`]: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                commitExtra(lot, index, f.value);
                                return;
                              }
                              // Same grid navigation as the valuation input, saving on the way out.
                              const el = e.currentTarget;
                              const atStart = el.selectionStart === 0 && el.selectionEnd === 0;
                              const atEnd = el.selectionStart === el.value.length && el.selectionEnd === el.value.length;
                              const at = rowFields.indexOf(f.value);
                              if (e.key === "ArrowUp" || e.key === "ArrowDown") {
                                e.preventDefault();
                                const target = e.key === "ArrowUp" ? index - 1 : index + 1;
                                saveExtra(lot, f.value).then((ok) => {
                                  if (ok) focusField(target, f.value);
                                });
                              } else if (e.key === "ArrowRight" && atEnd) {
                                e.preventDefault();
                                saveExtra(lot, f.value).then((ok) => {
                                  if (!ok) return;
                                  const nextField = rowFields[at + 1];
                                  if (nextField) focusField(index, nextField);
                                  else focusField(index + 1, "valuation");
                                });
                              } else if (e.key === "ArrowLeft" && atStart) {
                                e.preventDefault();
                                saveExtra(lot, f.value).then((ok) => {
                                  if (ok) focusField(index, rowFields[at - 1]);
                                });
                              }
                            }}
                          />
                        </TableCell>
                      ))}
                      <TableCell>
                        {complete ? (
                          <CheckCircleIcon sx={{ fontSize: 18, color: "var(--sage)" }} />
                        ) : saved ? (
                          <span title="Valued — classification still needed">
                            <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "var(--warn)" }} />
                          </span>
                        ) : (
                          <RadioButtonUncheckedIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} />
                        )}
                      </TableCell>
                      <TableCell sx={{ width: 40, p: 0.5 }}>
                        <Tooltip title="Focus on this lot (full details + keypad)">
                          <IconButton size="small" onClick={() => setFocusLotId(lot.id)} aria-label="Focus on this lot">
                            <OpenInFullIcon sx={{ fontSize: 15 }} />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
          )}
        </div>
      )}
    </div>
  );
}
