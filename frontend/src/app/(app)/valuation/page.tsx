"use client";

import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import FilterPanel from "@/components/catalogue/FilterPanel";
import LotViewDialog from "@/components/catalogue/LotViewDialog";
import PageHeader from "@/components/shared/PageHeader";
import LotRow, { type ExtraField, type RowField } from "@/components/valuation/LotRow";
import ValuationFocus from "@/components/valuation/ValuationFocus";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { CLASSIFICATIONS } from "@/lib/classifications";
import { buildExportColumns, defaultExportColumnIds, hiddenFromMeta } from "@/lib/exportColumns";
import { catalogueRemarkOf, hasValuation, valuationToText } from "@/lib/lotDisplay";
import {
  filterLots,
  isColumnFilterActive,
  type ColumnFilterState,
  type TicketStatus,
} from "@/lib/lotFilters";
import { buildValuationUpdate } from "@/lib/valuationUpdate";
import { parseValuationInput } from "@/lib/valuationInput";
import { loadSale, patchCachedLot } from "@/lib/saleCache";
import { sortForDisplay } from "@/lib/ourBroker";
import { STATUS_OPTIONS, type StatusFilter } from "@/lib/valuationFilters";
import { effectiveOfParsed, effectiveValuationOf, gradeStatsFor, suggestTier } from "@/lib/previousSale";
import type { ClassificationValue, Lot, PreviousGradeStats, ValuationUpdate } from "@/types/api";
import Button from "@mui/material/Button";
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
import CenterFocusStrongIcon from "@mui/icons-material/CenterFocusStrong";
import FilterListIcon from "@mui/icons-material/FilterList";
import SearchIcon from "@mui/icons-material/Search";
import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutlineOutlined";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

// The plain table below has no virtualization, so a ~12k-lot sale renders in chunks —
// more rows stream in as the list scrolls (or when keyboard navigation walks past the end).
const RENDER_CHUNK = 250;

const EXTRA_FIELDS: { value: ExtraField; label: string }[] = [
  { value: "liquorRemarks", label: "Taster's Remarks" },
  { value: "standardData", label: "Standard Data" },
  { value: "adjectiveData", label: "Adjective Data" },
  { value: "musterReport", label: "Muster Report" },
  { value: "brokerNotes", label: "Broker Notes" },
  { value: "privateNotes", label: "Private Notes" },
];

const isClassified = (lot: Lot) => (lot.valuation?.classification ?? "Unclassified") !== "Unclassified";

// Falls back to the catalogue's own imported Remarks column, the one field the broker's
// file really carries — the rest have no catalogue equivalent and stay blank until the
// taster enters something. Standard is excluded on purpose: it holds our sub-grade code,
// and merging the broker's column into it is what used to leave two codes in one field.
function catalogueSeedFor(lot: Lot, field: ExtraField): string | null {
  if (field === "brokerNotes") return catalogueRemarkOf(lot);
  return null;
}

export default function ValuationCentrePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeCatalogueId, activeCatalogue, catalogues } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loading, setLoading] = useState(false);
  // For the Sharings panel's previous-sale comparison — `catalogues` is already ordered
  // newest-first (ListCatalogues on the backend), so the previous sale is just the next
  // entry after the active one. Loaded through the same saleCache as everything else, so a
  // sale already visited elsewhere in the app (Catalogue Manager, an earlier valuation
  // session) is instant here too, and a sale nobody has opened yet is one lazy fetch.
  const [previousSaleLots, setPreviousSaleLots] = useState<Lot[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [savingId, setSavingId] = useState<string | null>(null);
  // Optional extra columns ("Also fill") worked in the same pass as the valuation.
  const [extraOn, setExtraOn] = useState<Set<ExtraField>>(new Set());
  const [extraValues, setExtraValues] = useState<Record<string, string>>({});
  // Lot currently blocked from advancing because its classification is still unset.
  const [clsNeededId, setClsNeededId] = useState<string | null>(null);
  // Per-grade classification history from the previous sale — drives auto-classification.
  const [prevStats, setPrevStats] = useState<PreviousGradeStats | null>(null);
  // Lots whose current classification was auto-picked from the previous sale (labels the hint).
  const [autoClsIds, setAutoClsIds] = useState<Set<string>>(new Set());
  // Lot whose auto-classification found no previous-sale data for its grade.
  const [noPrevDataId, setNoPrevDataId] = useState<string | null>(null);
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
  // Read-only full-details dialog for one lot (every catalogue column + remarks).
  const [viewLot, setViewLot] = useState<Lot | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  // Chunked rendering of the (unvirtualized) table: how many filtered rows are mounted.
  const [renderLimit, setRenderLimit] = useState(RENDER_CHUNK);
  // A row past the mounted chunk that keyboard navigation wants — focused once it renders.
  const [pendingFocus, setPendingFocus] = useState<{ index: number; field: RowField } | null>(null);

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

  // The filter pass walks the whole sale, far too slow for the render a keystroke lands in —
  // so it runs against these deferred copies: typing paints immediately and the pass catches
  // up in an interruptible background render, with `filtering` dimming the table meanwhile
  // (the same treatment the catalogue grid uses).
  const dSearch = useDeferredValue(search);
  const dStatusFilter = useDeferredValue(statusFilter);
  const dColumnFilters = useDeferredValue(columnFilters);
  const dTicketStatusFilter = useDeferredValue(ticketStatusFilter);
  const dClassificationFilter = useDeferredValue(classificationFilter);
  const dYearFilter = useDeferredValue(yearFilter);
  const filtering =
    search !== dSearch ||
    statusFilter !== dStatusFilter ||
    columnFilters !== dColumnFilters ||
    ticketStatusFilter !== dTicketStatusFilter ||
    classificationFilter !== dClassificationFilter ||
    yearFilter !== dYearFilter;

  // Start over with a small mounted chunk whenever the list being walked changes shape —
  // keyed to the deferred values so the reset lands with the recomputed list, not before it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setRenderLimit(RENDER_CHUNK);
  }, [catalogueId, dSearch, dStatusFilter, dColumnFilters, dTicketStatusFilter, dClassificationFilter, dYearFilter]);
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
    let cancelled = false;
    loadSale(activeCatalogueId)
      // Our own broker's lots first, ascending by lot number — an ordering, not a filter,
      // so the rest of the sale is still on the list right below them.
      .then((entry) => {
        if (!cancelled) setLots(sortForDisplay(entry.lots));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
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

  // The previous sale's lots, for the Sharings panel's cross-sale comparison (same mark +
  // grade last time round: status, sold price, best bid if it went unsold). `catalogues` is
  // newest-first, so the previous sale is whatever comes right after the active one in that
  // list — no catalogue not yet loaded (e.g. right after refreshList) just means no previous
  // sale is found yet, which resolves itself once the list catches up.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreviousSaleLots([]);
    if (!activeCatalogueId) return;
    const activeIdx = catalogues.findIndex((c) => c.id === activeCatalogueId);
    const previous = activeIdx === -1 ? undefined : catalogues[activeIdx + 1];
    if (!previous) return;
    let cancelled = false;
    loadSale(previous.id)
      .then((entry) => {
        if (!cancelled) setPreviousSaleLots(entry.lots);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [activeCatalogueId, catalogues]);

  // The working set is the whole selected sale — every lot from every broker, valued or
  // not, ordered by sortForDisplay (our own lots first, ascending by lot number). Anything
  // still unvalued is always on the list; the status filter narrows it down when wanted.
  const displayedLots = lots;

  // The list actually on screen — universal search (every raw column), per-column
  // filters, ticket status, classification and valuation progress all applied. Keyboard
  // navigation and focus mode both walk this filtered list.
  const visibleLots = useMemo(() => {
    const base = filterLots(displayedLots, {
      search: dSearch,
      columnFilters: dColumnFilters,
      status: dTicketStatusFilter,
      classification: dClassificationFilter,
      year: dYearFilter,
    });
    if (dStatusFilter === "all") return base;
    return base.filter((l) => {
      const valued = hasValuation(l);
      const classified = isClassified(l);
      if (dStatusFilter === "pending") return !(valued && classified);
      if (dStatusFilter === "unvalued") return !valued;
      if (dStatusFilter === "needs-classification") return valued && !classified;
      return valued && classified; // complete
    });
  }, [displayedLots, dSearch, dStatusFilter, dColumnFilters, dTicketStatusFilter, dClassificationFilter, dYearFilter]);

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
  // The row's own valuation text is local state seeded from `lot` (see LotRow) and re-syncs
  // itself once this updated `lot` reference reaches it — nothing to do for that here.
  const applyUpdatedLot = (updated: Lot) => {
    setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    if (activeCatalogueId) patchCachedLot(activeCatalogueId, updated);
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
        if (next[key] !== undefined) next[key] = updated.valuation?.[f.value] ?? catalogueSeedFor(updated, f.value) ?? "";
      });
      return next;
    });
  };

  // Seed savedIds for any newly-displayed lot. Each row seeds its own valuation text
  // locally (see LotRow) — this effect no longer needs to seed a page-level text map.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
            next[key] = l.valuation?.[f.value] ?? catalogueSeedFor(l, f.value) ?? "";
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

  // Stable across re-renders except when renderLimit/visibleLots genuinely change (filters,
  // extraOn, chunk growth) — none of which happen on a keystroke, so this identity survives
  // typing in any row, which is what lets LotRow's memoization actually hold.
  const focusField = useCallback(
    (index: number, field: RowField) => {
      const lot = visibleLots[index];
      if (!lot) return;
      // Walking past the mounted chunk: mount up to that row first, focus it after render.
      if (index >= renderLimit) {
        setRenderLimit(index + RENDER_CHUNK);
        setPendingFocus({ index, field });
        return;
      }
      if (field === "valuation") inputRefs.current[lot.id]?.focus();
      else if (field === "classification") clsRefs.current[lot.id]?.focus();
      else extraRefs.current[`${field}:${lot.id}`]?.focus();
    },
    [visibleLots, renderLimit]
  );

  // Complete a deferred focus once the requested row is mounted — a DOM focus side
  // effect (plus clearing its one-shot request), not derived state.
  useEffect(() => {
    if (!pendingFocus || pendingFocus.index >= renderLimit) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    focusField(pendingFocus.index, pendingFocus.field);
    setPendingFocus(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingFocus, renderLimit]);

  const focusRow = useCallback((index: number) => focusField(index, "valuation"), [focusField]);

  // Move focus to the next step in the row flow: valuation → classification → extras → next lot.
  // Classification is the gate — focus never reaches the next lot while this one is unclassified.
  // A lot with no valuation has nothing to classify, so the gate doesn't apply to it.
  const advance = useCallback(
    (lot: Lot, index: number, from: "valuation" | "classification" | ExtraField) => {
      if (hasValuation(lot) && !isClassified(lot)) {
        setClsNeededId(lot.id);
        clsRefs.current[lot.id]?.focus();
        return;
      }
      const order = enabledExtras.map((f) => f.value);
      const pos = from === "valuation" || from === "classification" ? 0 : order.indexOf(from) + 1;
      const nextField = order[pos];
      if (nextField) extraRefs.current[`${nextField}:${lot.id}`]?.focus();
      else focusRow(index + 1);
    },
    [enabledExtras, focusRow]
  );

  // Parse and save the typed value when it differs from what's stored. While the tier is
  // unset (or was itself auto-picked), the previous sale's suggested classification for
  // the new value rides along in the same call — a hand-picked tier is never touched.
  // Returns the lot to continue navigating with (updated, or as-is when nothing changed),
  // or null when the input is invalid or the save failed — the caller (LotRow) keeps its
  // own local text/error state in place on null. `text` and `onError` come from the row
  // itself, which now owns that state locally instead of a page-level map — see LotRow.
  const saveValuation = useCallback(
    async (lot: Lot, text: string, onError: (msg: string) => void): Promise<Lot | null> => {
      if (text === valuationToText(lot)) return lot;
      const parsed = parseValuationInput(text);
      if (parsed.kind === "error") {
        onError(parsed.message);
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
      if (parsed.kind === "clear") {
        // The value is gone, so the tier goes with it — hand-picked or not, a lot with no
        // valuation carries no classification (the API enforces this too).
        patch.classification = "Unclassified";
      } else if (currentCls === "Unclassified" || autoClsIds.has(lot.id)) {
        const stats = gradeStatsFor(prevStats, lot.grade);
        const liveValue = effectiveOfParsed(parsed);
        autoTier = stats && liveValue !== null ? suggestTier(stats, liveValue) : null;
        if (autoTier) patch.classification = autoTier;
      }

      setSavingId(lot.id);
      try {
        const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, patch));
        setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (activeCatalogueId) patchCachedLot(activeCatalogueId, updated);
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
        onError("Save failed — try again");
        return null;
      } finally {
        setSavingId(null);
      }
    },
    [activeCatalogueId, autoClsIds, prevStats]
  );

  // Auto-pick a classification from the previous sale's record for this lot's grade.
  // Returns the updated lot, or null when there's no usable history (callers fall back
  // to the manual classification gate).
  const autoClassify = useCallback(
    async (lot: Lot, onError: (msg: string) => void): Promise<Lot | null> => {
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
        if (activeCatalogueId) patchCachedLot(activeCatalogueId, updated);
        setAutoClsIds((prev) => new Set(prev).add(lot.id));
        setNoPrevDataId((id) => (id === lot.id ? null : id));
        return updated;
      } catch {
        onError("Save failed — try again");
        return null;
      } finally {
        setSavingId(null);
      }
    },
    [prevStats, activeCatalogueId]
  );

  // Save, then either move on, or — when the new value has no classification yet — try the
  // previous sale's auto-pick and report back which tier index this row should preview/focus
  // locally (clsCursor lives in LotRow now, not here — see LotRow's local state).
  const commit = useCallback(
    async (
      lot: Lot,
      index: number,
      text: string,
      onError: (msg: string) => void
    ): Promise<{ autoFocusClassificationAt: number } | void> => {
      const updated = await saveValuation(lot, text, onError);
      if (!updated) return;
      // A cleared/blank row is being abandoned, so no classification gate applies.
      if (!hasValuation(updated)) {
        focusRow(index + 1);
        return;
      }
      // Fresh valuation on an unclassified lot: auto-select the tier the previous sale
      // suggests, then hold focus on the chips so Enter accepts it or the user overrides.
      if (!isClassified(updated)) {
        const auto = await autoClassify(updated, onError);
        if (auto) {
          const at = CLASSIFICATIONS.findIndex((c) => c.value === auto.valuation?.classification);
          return { autoFocusClassificationAt: Math.max(0, at) };
        }
      }
      advance(updated, index, "valuation");
    },
    [saveValuation, autoClassify, focusRow, advance]
  );

  // Classification saves instantly on click — clicking the active tier again clears it.
  // Only ever on a valued lot: a tier grades a valuation, so an unvalued row's chips are
  // disabled and every keyboard path into here bounces off this guard.
  const commitClassification = useCallback(
    async (lot: Lot, index: number, value: ClassificationValue, onError: (msg: string) => void) => {
      if (!hasValuation(lot)) return;
      const current = lot.valuation?.classification ?? "Unclassified";
      const next: ClassificationValue = current === value ? "Unclassified" : value;
      setSavingId(lot.id);
      let updated: Lot;
      try {
        updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { classification: next }));
        setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (activeCatalogueId) patchCachedLot(activeCatalogueId, updated);
        // A hand-picked tier is an override — drop the "auto-selected" label and no-data note.
        setAutoClsIds((prev) => {
          if (!prev.has(lot.id)) return prev;
          const n = new Set(prev);
          n.delete(lot.id);
          return n;
        });
        setNoPrevDataId((id) => (id === lot.id ? null : id));
      } catch {
        onError("Save failed — try again");
        return;
      } finally {
        setSavingId(null);
      }
      if (next !== "Unclassified") {
        setClsNeededId((id) => (id === lot.id ? null : id));
        advance(updated, index, "classification");
      }
    },
    [activeCatalogueId, advance]
  );

  // Same contract as saveValuation: skips the API call when nothing changed, null on failure.
  // Reads the typed text from the page-level extraValues map (still page-owned, unlike the
  // valuation text — extra columns are an opt-in secondary path, not the common per-keystroke
  // cost this refactor targets).
  const saveExtra = useCallback(
    async (lot: Lot, field: ExtraField, onError: (msg: string) => void): Promise<Lot | null> => {
      const raw = (extraValues[`${field}:${lot.id}`] ?? "").trim();
      if (raw === (lot.valuation?.[field] ?? "").trim()) return lot;
      setSavingId(lot.id);
      try {
        const updated = await api.updateValuation(lot.id, buildValuationUpdate(lot, { [field]: raw === "" ? null : raw }));
        setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
        if (activeCatalogueId) patchCachedLot(activeCatalogueId, updated);
        return updated;
      } catch {
        onError("Save failed — try again");
        return null;
      } finally {
        setSavingId(null);
      }
    },
    [extraValues, activeCatalogueId]
  );

  const commitExtra = useCallback(
    async (lot: Lot, index: number, field: ExtraField, onError: (msg: string) => void) => {
      const updated = await saveExtra(lot, field, onError);
      if (updated) advance(updated, index, field);
    },
    [saveExtra, advance]
  );

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

  // Dashboard's "Continue Valuing" CTA links here with ?focus=1 — once this sale's lots
  // are actually loaded, drop straight into Focus mode at the first lot needing attention
  // instead of making the tap-through land on the plain list. Consumed once (the ref
  // guards against re-entering focus mode if the user deliberately exits it later while
  // the query param is still sitting in the URL) and then stripped from the URL so a
  // refresh or the back button doesn't replay it.
  const consumedFocusParam = useRef(false);
  useEffect(() => {
    if (consumedFocusParam.current) return;
    if (searchParams.get("focus") !== "1") return;
    if (loading || visibleLots.length === 0) return;
    consumedFocusParam.current = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    enterFocus();
    router.replace("/valuation");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, loading, visibleLots]);

  // The details dialog reads its lot fresh from state so saves made after opening still show.
  const viewLotLive = viewLot ? (lots.find((l) => l.id === viewLot.id) ?? viewLot) : null;

  if (!activeCatalogueId) {
    return <PageHeader title="Valuation Centre" subtitle="Load a catalogue from Catalogue Manager first." />;
  }

  return (
    <div>
      <PageHeader
        title="Valuation Centre"
        subtitle={
          <>
            {activeCatalogue?.sourceName} · {displayedLots.length.toLocaleString()} lot{displayedLots.length === 1 ? "" : "s"} ·
            values in <strong>LKR</strong>
          </>
        }
        actions={
          <>
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
              <ExportShareMenu
                lots={displayedLots}
                reportTitle={activeCatalogue?.sourceName ?? "Catalogue"}
                catalogueIdForLot={() => activeCatalogueId}
                availableColumns={buildExportColumns(activeCatalogue?.headers ?? [], false)}
                defaultColumnIds={defaultExportColumnIds(
                  activeCatalogue?.headers ?? [],
                  hiddenFromMeta(activeCatalogue?.columnMeta ?? {}),
                  false
                )}
              />
            )}
            <Button
              variant="contained"
              size="small"
              startIcon={<AddCircleOutlineIcon fontSize="small" />}
              onClick={() => router.push("/catalogue")}
            >
              Catalogue Manager
            </Button>
          </>
        }
      />

      {loading && <p className="text-text-muted text-sm mt-4">Loading lots…</p>}

      {!loading && displayedLots.length === 0 && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">This sale has no lots</h3>
          <p className="mb-4">Pick a different sale in Catalogue Manager — every lot of the selected sale shows here automatically.</p>
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
          previousSaleLots={previousSaleLots}
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
          {/* The how-to-use paragraph that sat here is in Help — the entry rules show
              themselves inline as you type (live feedback, tier hints, error messages). */}
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
            {filtering && (
              <span className="inline-flex items-center gap-1 text-brass text-[12px] font-mono">
                <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" />
                Updating…
              </span>
            )}
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
              variant="valuation"
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
            <div className={`text-center py-12 text-text-muted border border-border rounded-md bg-surface transition-opacity ${filtering ? "opacity-60" : ""}`}>
              <h3 className="font-display text-lg text-text mb-1">No lots match these filters</h3>
              <p className="m-0 text-[13px]">Adjust the search or status filter above, or clear the filters.</p>
            </div>
          )}

          {visibleLots.length > 0 && (
          <TableContainer
            component={Paper}
            variant="outlined"
            sx={{
              maxHeight: "68vh",
              borderColor: "var(--border)",
              transition: "opacity 150ms",
              ...(filtering ? { opacity: 0.6, pointerEvents: "none" } : null),
            }}
            onScroll={(e) => {
              // Nearing the bottom of the mounted rows mounts the next chunk.
              const el = e.currentTarget;
              if (el.scrollHeight - el.scrollTop - el.clientHeight < 600)
                setRenderLimit((l) => (l < visibleLots.length ? l + RENDER_CHUNK : l));
            }}
          >
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  {[
                    "Lot No",
                    "Grade",
                    "Broker",
                    "Selling Mark / Code",
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
                {visibleLots.slice(0, renderLimit).map((lot, index) => (
                  <LotRow
                    key={lot.id}
                    lot={lot}
                    index={index}
                    saved={savedIds.has(lot.id)}
                    saving={savingId === lot.id}
                    clsNeeded={clsNeededId === lot.id}
                    autoCls={autoClsIds.has(lot.id)}
                    noPrevData={noPrevDataId === lot.id}
                    active={activeValLotId === lot.id}
                    gradeStats={gradeStatsFor(prevStats, lot.grade)}
                    enabledExtras={enabledExtras}
                    extraValues={extraValues}
                    onExtraChange={(lotId, field, val) => setExtraValues((v) => ({ ...v, [`${field}:${lotId}`]: val }))}
                    onFocusValuation={(lotId) => setActiveValLotId(lotId)}
                    onBlurValuation={(lotId) => setActiveValLotId((id) => (id === lotId ? null : id))}
                    onSaveValuation={saveValuation}
                    onCommit={commit}
                    onCommitClassification={commitClassification}
                    onCommitExtra={commitExtra}
                    onSaveExtra={saveExtra}
                    onNavigate={focusField}
                    onView={(l) => {
                      setViewLot(l);
                      setViewOpen(true);
                    }}
                    onFocusMode={(id) => setFocusLotId(id)}
                    registerValuationRef={(el) => {
                      inputRefs.current[lot.id] = el;
                    }}
                    registerClassificationRef={(el) => {
                      clsRefs.current[lot.id] = el;
                    }}
                    registerExtraRef={(field, el) => {
                      extraRefs.current[`${field}:${lot.id}`] = el;
                    }}
                    rowFields={rowFields}
                  />
                ))}
              </TableBody>
            </Table>
            {renderLimit < visibleLots.length && (
              <div className="text-center py-2 text-[12px] text-text-muted">
                Showing {Math.min(renderLimit, visibleLots.length).toLocaleString()} of{" "}
                {visibleLots.length.toLocaleString()} lots — scroll for more
              </div>
            )}
          </TableContainer>
          )}
        </div>
      )}

      <LotViewDialog
        // Read the lot fresh from state so saves made after opening still show.
        lot={viewLotLive}
        open={viewOpen}
        gradeStats={gradeStatsFor(prevStats, viewLotLive?.grade ?? null)}
        onClose={() => setViewOpen(false)}
        onEdit={() => {
          // "Edit" from the details dialog drops into this page's focus mode for the lot.
          setViewOpen(false);
          if (viewLot) setFocusLotId(viewLot.id);
        }}
      />
    </div>
  );
}
