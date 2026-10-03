"use client";

import { useFillHeight } from "@/components/shared/useFillHeight";
import BusyOverlay from "@/components/shared/BusyOverlay";
import CatalogueGrid from "@/components/catalogue/CatalogueGrid";
import FilterPanel from "@/components/catalogue/FilterPanel";
import LotViewDialog from "@/components/catalogue/LotViewDialog";
import ValuationDrawer from "@/components/catalogue/ValuationDrawer";
import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import PageHeader from "@/components/shared/PageHeader";
import { SkeletonRows } from "@/components/shared/SkeletonBlock";
import TeaLoader from "@/components/shared/TeaLoader";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { buildExportColumns, defaultExportColumnIds } from "@/lib/exportColumns";
import {
  emptyColumnFilter,
  isColumnFilterActive,
  type ColumnFilterState,
  type StoredFilterState,
  type TicketStatus,
} from "@/lib/lotFilters";
import { combineSales, SALE_COLUMN_HEADER, type CombinedCatalogue, type SaleEntry } from "@/lib/multiSale";
import { invalidateSale, patchCachedLot, type SaleStatus } from "@/lib/saleCache";
import type { CatalogueDetail, ClassificationValue, LiveLoad, Lot } from "@/types/api";
import { CURATED_FILTERS, resolveHeader } from "@/lib/filterConfig";
import SearchIcon from "@mui/icons-material/Search";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import LinearProgress from "@mui/material/LinearProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import BoltIcon from "@mui/icons-material/Bolt";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const WORKSHEET_HANDOFF_KEY = "asc:worksheet:pending";

type WorksheetField =
  | "classification"
  | "standardData"
  | "adjectiveData"
  | "liquorRemarks"
  | "musterReport"
  | "brokerNotes"
  | "privateNotes";

const WORK_SECTIONS: { field: WorksheetField | "valuation"; label: string }[] = [
  { field: "valuation", label: "Valuation" },
  { field: "classification", label: "Classification" },
  { field: "liquorRemarks", label: "Taster's Remarks" },
  { field: "standardData", label: "Standard Data" },
  { field: "adjectiveData", label: "Adjective Data" },
  { field: "musterReport", label: "Muster Report" },
  { field: "brokerNotes", label: "Broker Notes" },
  { field: "privateNotes", label: "Private Notes" },
];

const CLASSIFICATION_LABELS: Record<string, string> = {
  SelectBest: "Select Best",
  Best: "Best",
  BelowBest: "Below Best",
  Poor: "Poor",
  Unclassified: "Unclassified",
};
const STATUS_LABELS: Record<string, string> = {
  full: "Ticket complete",
  partial: "In progress",
  empty: "Not started",
};

// Outlined-on-dark styling for the selection bar's buttons — MUI's default disabled grey
// is unreadable on the dark bar, so the locked (bulk-in-flight) state gets its own colors.
const DARK_BAR_BUTTON_SX = {
  color: "#fff",
  borderColor: "rgba(255,255,255,0.3)",
  "&.Mui-disabled": { color: "rgba(255,255,255,0.45)", borderColor: "rgba(255,255,255,0.15)" },
};

const EMPTY_COMBINED: CombinedCatalogue = {
  lots: [],
  headers: [],
  columnMeta: {},
  catalogueIdByLot: new Map(),
  saleNames: [],
};

/** The most rows one search returns per sale (the server's own cap). A search narrows things far below this. */
const SEARCH_LIMIT = 20000;

/** The filter panel's state - what a search is made of. */
interface SearchSpec {
  search: string;
  columnFilters: Record<string, ColumnFilterState>;
  status: TicketStatus | "";
  classification: string;
  year: string;
}
// The columns the report opens with: broker, lot no, selling mark, grade, category, bags, net weight (packing), total weight
// (the pinned Valuation column at the right is the app's own valuation; plus the Sale column when several sales are pooled). Everything else is one click away under Columns.
const DEFAULT_SHOWN_COLUMNS = [
  /^broker$/i,
  /^lot\.?\s?(no|number)/i,
  /^selling.?mark$/i,
  /^grade$/i,
  /^categor/i,
  /^bags$/i,
  /^net.?weight/i,
  /^total.?weight/i,
  /^valuation$/i,
  new RegExp(`^${SALE_COLUMN_HEADER}$`, "i"),
];

const EMPTY_SPEC: SearchSpec = { search: "", columnFilters: {}, status: "", classification: "", year: "" };

/** What one sale's search returned: the rows loaded so far, how many lots match in all, and the live-load state. */
interface SaleResult {
  detail: CatalogueDetail;
  rows: Lot[];
  total: number;
  live: LiveLoad | null;
}

/**
 * Search ONE sale on the server. The sale itself never comes to the browser - only the matching rows do. In a pooled
 * multi-sale view the "Sale" column filter picks which sales are searched (it isn't a real column on the server).
 */
async function searchSale(id: string, spec: SearchSpec, offset: number, limit: number): Promise<SaleResult> {
  const detail = await api.getCatalogue(id);
  const saleFilter = spec.columnFilters[SALE_COLUMN_HEADER];
  if (saleFilter?.kind === "categorical" && saleFilter.values.length > 0 && !saleFilter.values.includes(detail.sourceName)) {
    return { detail, rows: [], total: 0, live: null };
  }
  const columnFilters = { ...spec.columnFilters };
  delete columnFilters[SALE_COLUMN_HEADER];
  const res = await api.searchLots(id, { ...spec, columnFilters, offset, limit });
  return { detail, rows: res.rows, total: res.total, live: res.live ?? null };
}

function statusFrom(live: LiveLoad | null, total: number): SaleStatus {
  return live
    ? {
        live: true,
        loaded: live.loaded,
        total: live.saleTotal,
        complete: live.complete,
        fetchedAtUtc: live.fetchedAtUtc,
        refreshing: live.refreshing,
        error: live.error,
      }
    : { live: false, loaded: total, total, complete: true, fetchedAtUtc: null, refreshing: false, error: null };
}

/** The columns the filter panel offers dropdowns for - their option lists are what the server is asked for. */
function optionHeadersFor(headers: string[]): string[] {
  // Lot numbers are typed, never listed: a sale has thousands, and a list of them made the page laggy.
  return CURATED_FILTERS.filter((d) => d.label !== "Lot Number")
    .map((d) => resolveHeader(headers, d.patterns))
    .filter((h): h is string => h !== null);
}

/** "just now" / "3m ago" - for the live-data freshness pill. */
function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.floor(minutes / 60)}h ago`;
}

export default function CataloguePage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user } = useAuth();
  // Sale files are the system's source data — importing (which can overwrite a sale on
  // disk) is the administrator's job; everyone else works with what's already loaded.
  const canManageDataFiles = user?.roles.includes("Admin") ?? false;
  const {
    catalogues,
    activeCatalogueId,
    selectCatalogue,
    importFile,
    importing: catalogueLoading,
    error: catalogueError,
  } = useCatalogue();

  // Which sales are pooled into the working set. Seeded to the Topbar's active sale, then
  // grown/narrowed with the in-page "Sales" picker. Always at least one sale.
  const [selectedSaleIds, setSelectedSaleIds] = useState<string[]>([]);

  const saleYears = useMemo(
    () => Array.from(new Set(catalogues.map((c) => c.year))).sort((a, b) => b - a),
    [catalogues]
  );

  // The catalogue list, readable from callbacks without making them depend on it (a list refresh
  // must not re-run loadCombined and wipe the user's filters).
  const cataloguesRef = useRef(catalogues);
  useEffect(() => {
    cataloguesRef.current = catalogues;
  }, [catalogues]);
  // The Year filter mirrors the sale on screen: a single sale's year (which filters nothing out),
  // or "All" when several sales are pooled.
  const yearOfSelection = (ids: string[]): string => {
    if (ids.length !== 1) return "";
    const c = cataloguesRef.current.find((x) => x.id === ids[0]);
    return c ? String(c.year) : "";
  };

  const [combined, setCombined] = useState<CombinedCatalogue>(EMPTY_COMBINED);
  // Search mode: the grid shows the rows of the last search, not the whole sale.
  const [saleStatuses, setSaleStatuses] = useState<SaleStatus[]>([]);
  const [matchTotal, setMatchTotal] = useState(0); // lots matching the applied search, across the pooled sales
  const [saleTotal, setSaleTotal] = useState(0); // lots in the pooled sales, matching or not
  const [serverOptions, setServerOptions] = useState<Record<string, string[]>>({});
  const [searching, setSearching] = useState(false);
  const [loadingLots, setLoadingLots] = useState(false);

  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lot[]>([]);
  const [drawerLot, setDrawerLot] = useState<Lot | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [viewLot, setViewLot] = useState<Lot | null>(null);
  const [viewOpen, setViewOpen] = useState(false);
  const [workMenuAnchor, setWorkMenuAnchor] = useState<HTMLElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<HTMLElement | null>(null);
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterState>>({});
  // Outcome of the last bulk classify, shown only when some lots were left unclassified.
  const [bulkNotice, setBulkNotice] = useState<string | null>(null);
  // Which bulk action is in flight — locks the whole action bar (the API call plus the
  // sale reload behind it take a while on a big selection, and a second click would fire
  // the same bulk update again) and puts the spinner on the button that was clicked.
  const [bulkBusy, setBulkBusy] = useState<ClassificationValue | "clear" | null>(null);
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const [presetDialogOpen, setPresetDialogOpen] = useState(false);
  const [presetName, setPresetName] = useState("");
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNotice, setPresetNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow sale load overwriting a newer one when the selection changes fast.
  const loadSeq = useRef(0);
  // Set by the ?presetId= mount effect when applying a preset requires switching sales first —
  // loadCombined's resetView branch (which would otherwise blank every filter on that switch)
  // checks this and restores these values instead, so applying never races its own reset.
  const pendingPresetFilters = useRef<StoredFilterState | null>(null);

  const multiSale = selectedSaleIds.length > 1;
  // The "choose your filters" box fills the rest of the window, like the results grid that replaces it.
  const { ref: emptyBoxRef, height: emptyBoxHeight } = useFillHeight<HTMLDivElement>(240);
  const { lots, headers, columnMeta, catalogueIdByLot, saleNames } = combined;

  // ---- Search mode ----------------------------------------------------------------------------------
  // NOTHING is loaded when the page opens. Choosing a sale only fetches its column list and the dropdown option lists;
  // the lots stay on the server. The filter panel edits a DRAFT (the state above); Search (or Enter) sends it up and the
  // matching rows come back - that is all this page ever holds. `applied` is what the grid is currently showing.
  const resultsRef = useRef(new Map<string, SaleResult>());
  const detailsRef = useRef(new Map<string, CatalogueDetail>());
  const appliedRef = useRef<SearchSpec>(EMPTY_SPEC);
  const statusesRef = useRef<SaleStatus[]>([]);
  const hasSearchedRef = useRef(false);
  const watchId = useRef(0);
  const rerunTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadCombinedRef = useRef<(resetView: boolean) => Promise<void>>(async () => undefined);
  const [applied, setApplied] = useState<SearchSpec>(EMPTY_SPEC);
  const [hasSearched, setHasSearched] = useState(false);

  // The Year dropdown is a sale picker, not a filter, so it is never part of a search.
  const draft = useMemo<SearchSpec>(
    () => ({ search, columnFilters, status: statusFilter, classification: classificationFilter, year: "" }),
    [search, columnFilters, statusFilter, classificationFilter]
  );
  const searchPending = useMemo(() => JSON.stringify(draft) !== JSON.stringify(applied), [draft, applied]);

  const markSearched = () => {
    hasSearchedRef.current = true;
    setHasSearched(true);
  };

  // Dropdown option lists and the sale's OKLO load state come from the server (the browser holds no lots). Returns true
  // while any sale is still arriving from OKLO.
  const refreshOptions = useCallback(async (ids: string[]): Promise<boolean> => {
    const merged: Record<string, string[]> = {};
    const statuses: (SaleStatus | undefined)[] = [];
    let total = 0;
    await Promise.all(
      ids.map(async (id, i) => {
        const detail = detailsRef.current.get(id);
        if (!detail) return;
        try {
          const r = await api.getFilterOptions(id, optionHeadersFor(detail.headers));
          for (const [header, values] of Object.entries(r.options)) {
            merged[header] = merged[header] ? Array.from(new Set([...merged[header], ...values])) : values;
          }
          statuses[i] = statusFrom(r.live ?? null, r.saleTotal);
          total += r.live?.saleTotal ?? r.saleTotal;
        } catch {
          statuses[i] = statusFrom(null, detail.rowCount);
          total += detail.rowCount;
        }
      })
    );
    if (ids.length > 1) merged[SALE_COLUMN_HEADER] = ids.map((id) => detailsRef.current.get(id)?.sourceName ?? "");
    setServerOptions(merged);
    const list = statuses.filter((x): x is SaleStatus => !!x);
    statusesRef.current = list;
    setSaleStatuses(list);
    setSaleTotal(total);
    return list.some((x) => x.live && !x.complete);
  }, []);

  // Runs the search on every selected sale and shows the result. Returns the pooled table, or null when a newer
  // search superseded this one.
  const executeSearch = useCallback(async (ids: string[], spec: SearchSpec, seq: number): Promise<CombinedCatalogue | null> => {
    const results = new Map<string, SaleResult>();
    await Promise.all(
      ids.map(async (id) => {
        results.set(id, await searchSale(id, spec, 0, SEARCH_LIMIT));
      })
    );
    if (seq !== loadSeq.current) return null;
    resultsRef.current = results;
    const entries: SaleEntry[] = ids.map((id) => {
      const r = results.get(id) as SaleResult;
      return { id, sourceName: r.detail.sourceName, detail: r.detail, lots: r.rows };
    });
    const c = combineSales(entries, ids.length > 1);
    setCombined(c);
    const statuses = ids.map((id) => {
      const r = results.get(id) as SaleResult;
      return statusFrom(r.live, r.detail.rowCount);
    });
    statusesRef.current = statuses;
    setSaleStatuses(statuses);
    setSaleTotal([...results.values()].reduce((n, r) => n + (r.live?.saleTotal ?? r.detail.rowCount), 0));
    return c;
  }, []);

  // While a sale is still arriving from OKLO, keep the dropdown lists (and, once a search has been made, its results)
  // in step every few seconds until it is all here. A newer sale selection cancels the watch.
  const watchSale = useCallback(
    async (ids: string[]) => {
      const mine = ++watchId.current;
      let incomplete = await refreshOptions(ids);
      while (incomplete && mine === watchId.current) {
        await new Promise<void>((resolve) => {
          rerunTimer.current = setTimeout(resolve, 3000);
        });
        if (mine !== watchId.current) return;
        incomplete = await refreshOptions(ids);
        if (hasSearchedRef.current) await executeSearch(ids, appliedRef.current, ++loadSeq.current);
      }
    },
    [refreshOptions, executeSearch]
  );

  // The sale selection changed (or the page just opened): fetch each sale's columns and dropdown lists - NOT its lots.
  // With no `resetView` this is the "reload" that follows an edit, which repeats the applied search if there is one.
  const loadCombined = useCallback(
    async (resetView: boolean) => {
      if (selectedSaleIds.length === 0) {
        setCombined(EMPTY_COMBINED);
        setSaleStatuses([]);
        return;
      }
      const ids = selectedSaleIds;
      const seq = ++loadSeq.current;
      setLoadingLots(true);
      try {
        if (resetView) {
          const pending = pendingPresetFilters.current;
          pendingPresetFilters.current = null;
          // The previous sale's numbers must not linger while the new one loads.
          setSaleStatuses([]);
          setSaleTotal(0);
          const details = await Promise.all(ids.map((id) => api.getCatalogue(id)));
          if (seq !== loadSeq.current) return; // a newer selection superseded this one
          detailsRef.current = new Map(ids.map((id, i) => [id, details[i]]));
          resultsRef.current = new Map();
          const entries: SaleEntry[] = ids.map((id, i) => ({ id, sourceName: details[i].sourceName, detail: details[i], lots: [] }));
          const c = combineSales(entries, ids.length > 1);
          const spec: SearchSpec = pending
            ? { search: pending.search, columnFilters: pending.columnFilters, status: pending.status, classification: pending.classification, year: "" }
            : EMPTY_SPEC;
          setCombined(c);
          setHiddenColumns(new Set(c.headers.filter((h) => !DEFAULT_SHOWN_COLUMNS.some((re) => re.test(h)))));
          setColumnFilters(spec.columnFilters);
          setStatusFilter(spec.status);
          setClassificationFilter(spec.classification);
          setSearch(spec.search);
          setYearFilter(yearOfSelection(ids));
          setSelected([]);
          setSaleTotal(details.reduce((n, d) => n + d.rowCount, 0));
          setSaleStatuses([]);
          appliedRef.current = EMPTY_SPEC;
          setApplied(EMPTY_SPEC);
          hasSearchedRef.current = false;
          setHasSearched(false);
          void watchSale(ids);
          if (pending) {
            // A saved filter set was opened on purpose: run it straight away.
            const r = await executeSearch(ids, spec, seq);
            if (r) {
              appliedRef.current = spec;
              setApplied(spec);
              markSearched();
            }
          }
        } else {
          // A newer pull of the sale arrived: repeat the applied search (if one was made) and refresh the dropdown lists,
          // which may now offer new values (a new buyer, a new mark).
          if (hasSearchedRef.current) await executeSearch(ids, appliedRef.current, seq);
          void refreshOptions(ids);
        }
      } finally {
        if (seq === loadSeq.current) setLoadingLots(false);
      }
    },
    [selectedSaleIds, executeSearch, watchSale, refreshOptions]
  );
  useEffect(() => {
    loadCombinedRef.current = loadCombined;
  }, [loadCombined]);

  // Search with the given filters (the Search button / Enter run the draft; "Clear all" runs the empty set).
  const runSpec = useCallback(
    async (spec: SearchSpec) => {
      if (selectedSaleIds.length === 0) return;
      const seq = ++loadSeq.current;
      setSearching(true);
      try {
        const c = await executeSearch(selectedSaleIds, spec, seq);
        if (!c) return;
        appliedRef.current = spec;
        setApplied(spec);
        markSearched();
        setSelected([]);
      } catch (e) {
        setImportError(e instanceof Error ? e.message : "Search failed");
      } finally {
        if (seq === loadSeq.current) setSearching(false);
      }
    },
    [selectedSaleIds, executeSearch]
  );
  const handleSearch = () => void runSpec(draft);

  // Keep an open page current: every 30s ask (cheaply) whether the backend has pulled a newer copy of a sale, and if so
  // repeat the applied search silently (if one was made) and refresh the dropdown lists. Stops with the page.
  useEffect(() => {
    if (selectedSaleIds.length === 0) return;
    // Just after the page loads the layout has asked OKLO for a fresh pull, so look every 8s for the first 3 minutes, then
    // settle to every 30s.
    const startedAt = Date.now();
    let tick = 0;
    const timer = setInterval(async () => {
      tick++;
      if (Date.now() - startedAt > 180_000 && tick % 4 !== 0) return;
      if (document.visibilityState !== "visible") return;
      for (let i = 0; i < selectedSaleIds.length; i++) {
        const st = statusesRef.current[i];
        if (!st?.live) continue;
        // Still arriving from OKLO: a search made while the sale was 0% (or partly) loaded would otherwise stay stuck at
        // whatever it found back then (an old search response has no version to compare against) - keep re-running it as
        // more rows land, the same as the "a newer pull arrived" case below does once the sale finishes.
        if (!st.complete) {
          void loadCombinedRef.current(false);
          return;
        }
        if (!st.fetchedAtUtc) continue;
        try {
          const probe = await api.getLots(selectedSaleIds[i], { pageSize: 1, knownVersion: st.fetchedAtUtc });
          if (probe.live && !probe.live.unchanged) {
            void loadCombinedRef.current(false);
            return;
          }
        } catch {
          // A missed check is harmless - the next one tries again.
        }
      }
    }, 8_000);
    return () => clearInterval(timer);
  }, [selectedSaleIds]);
  useEffect(
    () => () => {
      watchId.current++;
      if (rerunTimer.current) clearTimeout(rerunTimer.current);
    },
    []
  );

  // Reload from scratch (reset view) whenever the pooled sale selection changes.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCombined(true);
  }, [loadCombined]);

  // Picking a sale in the Topbar resets the page to that single sale — the in-page picker
  // then grows the pool from there. Keeps the Topbar behaving exactly as before.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSaleIds(activeCatalogueId ? [activeCatalogueId] : []);
  }, [activeCatalogueId]);

  // A "?presetId=" from Saved Filters' Apply button (mirrors Reports' "?catalogueId=" reopen).
  // Guarded by a ref (not an empty dep array) so it fires exactly once but with fresh closures
  // — activeCatalogueId/loadCombined/selectCatalogue are still settling on a fresh navigation,
  // and this effect needs whichever value is current at the moment it actually runs, not a
  // stale mount-time snapshot.
  const presetAppliedRef = useRef(false);
  useEffect(() => {
    if (presetAppliedRef.current) return;
    const presetId = searchParams.get("presetId");
    if (!presetId) return;
    presetAppliedRef.current = true;
    api
      .getFilterPreset(presetId)
      .then((preset) => {
        const filters = JSON.parse(preset.filtersJson) as StoredFilterState;
        pendingPresetFilters.current = filters;
        if (preset.catalogueId !== activeCatalogueId) {
          selectCatalogue(preset.catalogueId); // switching sales triggers its own loadCombined(true)
        } else {
          loadCombined(true); // already on the right sale — nothing else will reload, so do it here
        }
      })
      .catch(() => {
        // Preset may have been deleted since the link was created — the page just loads
        // with no filters applied, same as visiting /catalogue directly.
      });
  }, [searchParams, activeCatalogueId, loadCombined, selectCatalogue]);

  const reload = useCallback(() => loadCombined(false), [loadCombined]);

  const toggleSale = (id: string) => {
    setSelectedSaleIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      if (next.length === 0) return prev; // keep at least one sale in the pool
      // Order by the catalogue list (newest first) so sale blocks stay in a stable order.
      return catalogues.filter((c) => next.includes(c.id)).map((c) => c.id);
    });
  };

  // Picking a year in the Filters panel's Year dropdown (FilterPanel.allYears lists every
  // year in the system, not just currently-loaded lots) auto-loads that year's sales into
  // the working set if none of them are loaded yet — otherwise picking "2025" with only a
  // 2026 sale loaded would just filter everything down to zero rows.
  const handleYearFilterChange = (v: string) => {
    setYearFilter(v);
    const year = Number(v);
    if (!v || !Number.isFinite(year)) return;
    // Picking a year always lands on that year's LATEST sale (catalogues are newest first). Sales are
    // pulled live from OKLO when opened, so a year is never loaded wholesale - the Sale dropdown next
    // to Year steps to any other sale of that year.
    const latest = catalogues.find((c) => c.year === year);
    if (!latest) return;
    if (selectedSaleIds.length === 1 && selectedSaleIds[0] === latest.id) return;
    void selectCatalogue(latest.id);
    setSelectedSaleIds([latest.id]);
  };

  // Picking a sale in the Sale dropdown: show just that sale, and keep the Topbar's active sale and the
  // Year filter in step with it.
  const handleSaleSelect = (id: string) => {
    const c = catalogues.find((x) => x.id === id);
    void selectCatalogue(id);
    setSelectedSaleIds([id]);
    if (c) setYearFilter(String(c.year));
  };

  // Opening the Catalogue Reports starts on the latest year's latest sale, not on whichever sale
  // happened to be open last time. (A saved preset opened via ?presetId= picks its own sale.)
  const latestAppliedRef = useRef(false);
  useEffect(() => {
    if (latestAppliedRef.current || catalogues.length === 0) return;
    latestAppliedRef.current = true;
    if (searchParams.get("presetId")) return;
    // Start on the latest year's latest sale - selected at once, so Year and Sale are filled in before anything loads.
    const newest = catalogues[0];
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setYearFilter(String(newest.year));
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSelectedSaleIds([newest.id]);
    if (newest.id !== activeCatalogueId) void selectCatalogue(newest.id);
  }, [catalogues, activeCatalogueId, searchParams, selectCatalogue]);

  // Sales offered by the Sale dropdown: the chosen year's (all when Year is "All"), newest first.
  const saleOptions = useMemo(
    () =>
      catalogues
        .filter((c) => !yearFilter || String(c.year) === yearFilter)
        .map((c) => {
          // Just "Sale 37": the Year dropdown beside it already says which year. With Year on "All" the same
          // number exists in several years, so the year is added back to keep the entries distinguishable.
          const short = /Sale\s+(\d+)/i.exec(c.sourceName);
          const name = short ? `Sale ${short[1]}` : c.sourceName;
          return { id: c.id, label: yearFilter ? name : `${name} · ${c.year}` };
        }),
    [catalogues, yearFilter]
  );

  const toggleColumn = (header: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(header)) next.delete(header);
      else next.add(header);
      return next;
    });
  };

  const setColumnFilter = (header: string, value: ColumnFilterState) => {
    setColumnFilters((prev) => ({ ...prev, [header]: value }));
  };

  const clearAllFilters = () => {
    setColumnFilters({});
    setStatusFilter("");
    setClassificationFilter("");
    setSearch("");
    // If lots are showing, they go back to the unfiltered set; before the first search there is nothing to redo.
    if (hasSearchedRef.current) void runSpec(EMPTY_SPEC);
  };

  // The grid shows the rows of the last search as they are - filtering happens on the server, when Search is pressed.
  const filteredLots = lots;
  const filtering = searching;

  // Where the OKLO-served sales in the pool stand: still arriving, or complete and how fresh.
  const liveStatuses = saleStatuses.filter((s) => s.live);
  const arriving = liveStatuses.filter((s) => !s.complete);
  const liveLoading = arriving.length > 0;
  const liveLoaded = arriving.reduce((n, s) => n + s.loaded, 0);
  const liveTotal = arriving.reduce((n, s) => n + s.total, 0);
  const liveRefreshing = liveStatuses.some((s) => s.refreshing);
  const liveError = liveStatuses.find((s) => s.error)?.error ?? null;
  // The oldest pull among the pooled live sales - the honest "as of" for the whole table.
  const liveSyncedAt =
    liveStatuses.length > 0 && liveStatuses.every((s) => s.fetchedAtUtc)
      ? liveStatuses.map((s) => s.fetchedAtUtc as string).sort()[0]
      : null;

  const activeFilterChips = useMemo(() => {
    const chips: { key: string; label: string; onRemove: () => void }[] = [];
    Object.entries(columnFilters).forEach(([header, f]) => {
      if (!isColumnFilterActive(f)) return;
      const label =
        f.kind === "categorical"
          ? `${header}: ${f.values.join(", ")}`
          : f.kind === "numeric"
            ? `${header}: ${f.min || "…"}–${f.max || "…"}`
            : f.kind === "lot"
              ? `${header}: ${[f.min || f.max ? `${f.min || "…"}–${f.max || "…"}` : "", f.values.join(", ")].filter(Boolean).join(" + ")}`
              : `${header}: "${f.value}"`;
      chips.push({
        key: `col-${header}`,
        label,
        onRemove: () => setColumnFilters((prev) => ({ ...prev, [header]: emptyColumnFilter(columnMeta[header]) })),
      });
    });
    if (statusFilter) {
      chips.push({ key: "status", label: `Status: ${STATUS_LABELS[statusFilter]}`, onRemove: () => setStatusFilter("") });
    }
    if (classificationFilter) {
      chips.push({
        key: "classification",
        label: `Classification: ${CLASSIFICATION_LABELS[classificationFilter]}`,
        onRemove: () => setClassificationFilter(""),
      });
    }
    return chips;
  }, [columnFilters, statusFilter, classificationFilter, columnMeta]);

  const activeFilterCount = activeFilterChips.length;

  // Export plumbing — the picker's available columns, and which are ticked by default (the
  // grid's shown columns + valuation/classification, plus Sale when spanning sales).
  const availableExportColumns = useMemo(() => buildExportColumns(headers, multiSale), [headers, multiSale]);
  const exportDefaultColumnIds = useMemo(
    () => defaultExportColumnIds(headers, hiddenColumns, multiSale),
    [headers, hiddenColumns, multiSale]
  );
  const catalogueIdForLot = useCallback(
    (l: Lot) => catalogueIdByLot.get(l.id) ?? activeCatalogueId ?? "",
    [catalogueIdByLot, activeCatalogueId]
  );
  const reportTitle = saleNames.length === 1 ? saleNames[0] : `${saleNames.length} sales`;

  // How many distinct sales the current selection spans — Valuation/Worksheet are per-sale,
  // so those hand-offs only work when the selection sits inside a single sale.
  const selectionSaleCount = useMemo(
    () => new Set(selected.map((l) => catalogueIdByLot.get(l.id))).size,
    [selected, catalogueIdByLot]
  );
  const workDisabled = selectionSaleCount !== 1;

  // The first import (from the empty-state dropzone) — bring the file in and switch to it.
  const handleFile = async (file: File) => {
    setImportError(null);
    try {
      await importFile(file);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    }
  };

  // Import an extra file into the working set: it joins the pooled sales (rather than
  // replacing the view), so it's immediately filterable / exportable / valuable alongside
  // the rest. Its columns union in with the others — the same layout mostly, so it just fits.
  const handleImport = async (file: File) => {
    setImportError(null);
    setImportNotice(null);
    try {
      const detail = await importFile(file, { select: false });
      setSelectedSaleIds((prev) => (prev.includes(detail.id) ? prev : [...prev, detail.id]));
      setImportNotice(`Imported ${detail.sourceName} — added to your selected sales.`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    }
  };

  // Saves the page's real filter state (this — not AG Grid's own per-column filters, which
  // are a separate, redundant layer on top of the already-filtered rows this page hands the
  // grid). Only meaningful for a single sale, so it's saved against activeCatalogueId even
  // when several are currently pooled.
  const savePreset = async () => {
    if (!activeCatalogueId || !presetName.trim()) return;
    setSavingPreset(true);
    try {
      const filters: StoredFilterState = {
        search,
        columnFilters,
        status: statusFilter,
        classification: classificationFilter,
        year: yearFilter,
      };
      await api.saveFilterPreset(activeCatalogueId, presetName.trim(), JSON.stringify(filters));
      setPresetDialogOpen(false);
      setPresetName("");
      setPresetNotice(`Saved filter preset "${presetName.trim()}".`);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Could not save the preset");
    } finally {
      setSavingPreset(false);
    }
  };

  const editLot = (lot: Lot) => {
    setDrawerLot(lot);
    setDrawerOpen(true);
  };

  const viewLotDetails = (lot: Lot) => {
    setViewLot(lot);
    setViewOpen(true);
  };

  const handleSaved = (updated: Lot) => {
    setCombined((prev) => ({ ...prev, lots: prev.lots.map((l) => (l.id === updated.id ? updated : l)) }));
    const saleId = catalogueIdByLot.get(updated.id);
    if (saleId) patchCachedLot(saleId, updated); // keep the cache warm and in sync
    setDrawerOpen(false);
  };

  // Drop the cache for every sale the given lots belong to — used after a bulk edit whose
  // per-lot results aren't returned, so the follow-up reload refetches only those sales.
  const invalidateLotSales = useCallback(
    (ls: Lot[]) => {
      new Set(ls.map((l) => catalogueIdByLot.get(l.id)))
        .forEach((id) => id && invalidateSale(id));
    },
    [catalogueIdByLot]
  );

  // Hands the current selection off to the right workspace for the chosen section. Valuation
  // has its own page (it always shows the whole sale, so no lot hand-off is needed) — every
  // other section shares the Lot Worksheet. Both are per-sale, so the selection must sit in
  // one sale (the button is disabled otherwise); if that sale isn't the active one, switch to
  // it first so the target page opens on the right catalogue.
  const openWorkSection = async (section: WorksheetField | "valuation") => {
    setWorkMenuAnchor(null);
    if (selected.length === 0 || workDisabled) return;
    const saleId = catalogueIdByLot.get(selected[0].id);
    if (!saleId) return;
    const lotIds = selected.map((l) => l.id);
    if (section === "valuation") {
      if (saleId !== activeCatalogueId) await selectCatalogue(saleId);
      router.push("/valuation");
    } else {
      window.sessionStorage.setItem(
        WORKSHEET_HANDOFF_KEY,
        JSON.stringify({ catalogueId: saleId, lotIds, field: section })
      );
      router.push("/worksheet");
    }
  };

  const bulkClassify = async (classification: ClassificationValue) => {
    if (selected.length === 0 || bulkBusy) return;
    setBulkBusy(classification);
    try {
      const { updated, skipped } = await api.bulkClassify(selected.map((l) => l.id), classification);
      setBulkNotice(
        skipped > 0
          ? `Classified ${updated.toLocaleString()} lot${updated === 1 ? "" : "s"} — ${skipped.toLocaleString()} skipped with no valuation yet.`
          : null
      );
      invalidateLotSales(selected);
      await reload();
      setSelected([]);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Bulk classify failed");
    } finally {
      setBulkBusy(null);
    }
  };

  const bulkClearNotes = async () => {
    if (selected.length === 0 || bulkBusy) return;
    setBulkBusy("clear");
    try {
      await api.bulkClearNotes(selected.map((l) => l.id));
      invalidateLotSales(selected);
      await reload();
      setSelected([]);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Clearing notes failed");
    } finally {
      setBulkBusy(null);
    }
  };

  if (!activeCatalogueId) {
    if (!canManageDataFiles) {
      // Non-admins can't upload sale files — with nothing loaded yet there's nothing for
      // them to do here but wait for an administrator to bring the data in.
      return (
        <div>
          <PageHeader title="Catalogue Reports" />
          <div className="max-w-2xl mx-auto border-2 border-dashed border-brass rounded-[var(--radius-lg)] bg-surface p-8 text-center">
            <h2 className="font-display text-2xl text-text-strong mb-2">No sales loaded yet</h2>
            <p className="text-[13px] text-text-muted m-0">
              Sale catalogues are added by an administrator. Once a sale file has been uploaded, it will appear
              here automatically.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div>
        {catalogueLoading && <BusyOverlay message="Importing sale file…" />}
        <PageHeader
          title="Catalogue Reports"
          subtitle="Upload a lot catalogue to begin — search, filter, value and dictate remarks for every lot."
        />

        <div
          onDragOver={(e) => {
            e.preventDefault();
            if (!catalogueLoading) setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            if (catalogueLoading) return; // already importing — a second drop here would race it
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          onClick={() => {
            if (!catalogueLoading) fileInputRef.current?.click();
          }}
          aria-busy={catalogueLoading}
          className={`max-w-2xl mx-auto border-2 border-dashed rounded-[var(--radius-lg)] bg-surface p-8 text-center transition-colors ${
            catalogueLoading ? "cursor-default" : "cursor-pointer"
          } ${dragOver ? "border-sage bg-sage-light" : "border-brass"}`}
        >
          {catalogueLoading ? (
            <div className="flex flex-col items-center gap-3">
              <TeaLoader size={48} />
              <p className="text-[13px] text-text-muted m-0">
                Importing sale file — this can take a little while for a large catalogue…
              </p>
            </div>
          ) : (
            <>
              <h2 className="font-display text-2xl text-text-strong mb-2">Drop your catalogue here</h2>
              <p className="text-[13px] text-text-muted mb-5">
                Click to browse, or drag an Excel file in. Parsed and stored server-side in MongoDB via the ASP.NET Core API.
              </p>
              <Button
                variant="contained"
                disabled={catalogueLoading}
                onClick={(e) => {
                  e.stopPropagation();
                  fileInputRef.current?.click();
                }}
              >
                Choose file
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xls,.xlsx,.csv,.ods"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
              <p className="font-mono text-[11px] text-text-muted mt-4 tracking-wide">.XLS · .XLSX · .CSV</p>
            </>
          )}
        </div>

        {(importError || catalogueError) && (
          <p className="max-w-2xl mx-auto mt-4 text-center text-danger text-sm">{importError ?? catalogueError}</p>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Catalogue Reports"
        subtitle={`${reportTitle} · ${saleTotal.toLocaleString()} lots · ${headers.length} columns`}
        actions={
          <>
            {canManageDataFiles && (
              <Button
                variant="outlined"
                size="small"
                startIcon={<UploadFileOutlinedIcon fontSize="small" />}
                onClick={() => fileInputRef.current?.click()}
                disabled={catalogueLoading}
                aria-busy={catalogueLoading}
              >
                {catalogueLoading ? "Importing…" : "Import file"}
              </Button>
            )}
          </>
        }
      />
      <div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx,.csv,.ods"
          className="hidden"
          disabled={catalogueLoading}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f && !catalogueLoading) handleImport(f);
            e.target.value = "";
          }}
        />

        <Menu anchorEl={columnsMenuAnchor} open={!!columnsMenuAnchor} onClose={() => setColumnsMenuAnchor(null)}>
          {headers.map((h) => (
            <MenuItem key={h} onClick={() => toggleColumn(h)} dense>
              <Checkbox checked={!hiddenColumns.has(h)} size="small" />
              <ListItemText primary={h} />
            </MenuItem>
          ))}
        </Menu>
      </div>

      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <TextField
          placeholder="Search across every column…"
          size="small"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSearch();
          }}
          // Full width on phones (it gets its own wrapped row), fixed on larger screens.
          sx={{ width: { xs: "100%", sm: 340 } }}
        />
        <Button
          variant={searchPending ? "contained" : "outlined"}
          size="small"
          startIcon={<SearchIcon fontSize="small" />}
          onClick={handleSearch}
          disabled={searching || selectedSaleIds.length === 0}
        >
          {searching ? "Searching…" : "Search"}
        </Button>
        {activeFilterCount > 0 && (
          <Button
            variant="outlined"
            size="small"
            startIcon={<BookmarkAddOutlinedIcon fontSize="small" />}
            onClick={() => setPresetDialogOpen(true)}
          >
            Save as Preset
          </Button>
        )}
        <span className="text-[12px] text-text-muted font-mono ml-auto flex items-center gap-2">
          {liveSyncedAt && !liveLoading && (
            <Tooltip title="Sale data is pulled live from OKLO SmartAuction and re-checked while this page is open.">
              <span className="inline-flex items-center gap-1 text-sage-dark">
                <span className={`w-1.5 h-1.5 rounded-full bg-sage ${liveRefreshing ? "animate-pulse" : ""}`} />
                Live · updated {timeAgo(liveSyncedAt)}
              </span>
            </Tooltip>
          )}
          {((loadingLots && lots.length > 0) || filtering) && (
            <span className="inline-flex items-center gap-1 text-brass">
              <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" />
              Updating…
            </span>
          )}
          {hasSearched
            ? `${lots.length.toLocaleString()} lot${lots.length === 1 ? "" : "s"} found`
            : loadingLots && saleTotal === 0
              ? "Loading sale…"
              : `${saleTotal.toLocaleString()} lots in this sale`}
        </span>
      </div>

      {liveLoading && (
        <div className="mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-brass bg-surface text-[13px]" role="status" aria-live="polite">
          <div className="flex items-center gap-2 mb-1.5" style={{ color: "var(--text-strong)" }}>
            <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" />
            Loading from OKLO… {liveLoaded.toLocaleString()} of {liveTotal.toLocaleString()} lots
            <span className="text-text-muted text-[12px]">- the dropdown lists fill in as it loads{hasSearched ? ", and your results update" : ""}</span>
          </div>
          <LinearProgress
            variant={liveTotal > 0 ? "determinate" : "indeterminate"}
            value={liveTotal > 0 ? Math.min(100, (liveLoaded / liveTotal) * 100) : 0}
            sx={{ height: 4, borderRadius: 2 }}
          />
        </div>
      )}
      {liveError && !liveLoading && (
        <div className="mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-brass bg-surface text-[13px]" style={{ color: "var(--text-strong)" }}>
          {liveError}
        </div>
      )}

      {headers.length > 0 && (
        <FilterPanel
          headers={headers}
          columnMeta={columnMeta}
          lots={lots}
          columnFilters={columnFilters}
          onColumnFilterChange={setColumnFilter}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          classification={classificationFilter}
          onClassificationChange={setClassificationFilter}
          year={yearFilter}
          onYearChange={handleYearFilterChange}
          allYears={saleYears}
          saleOptions={saleOptions}
          saleValue={selectedSaleIds.length === 1 ? selectedSaleIds[0] : ""}
          saleMultiLabel={selectedSaleIds.length > 1 ? `${selectedSaleIds.length} sales pooled` : null}
          onSaleChange={handleSaleSelect}
          serverOptions={serverOptions}
          onSearch={handleSearch}
          bodyMaxHeight="max(140px, calc(100vh - 660px))"
          toolbar={
            <>
              <ExportShareMenu
                lots={filteredLots}
                reportTitle={reportTitle}
                catalogueIdForLot={catalogueIdForLot}
                availableColumns={availableExportColumns}
                defaultColumnIds={exportDefaultColumnIds}
                label="Download"
                hideShare
                large
              />
              <Button
                variant="outlined"
                startIcon={<ViewColumnIcon fontSize="small" />}
                onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
                sx={{ height: 40 }}
              >
                Columns
              </Button>
            </>
          }
          searchPending={searchPending}
          allowAllYears={false}
          onClearAll={clearAllFilters}
          extraCategoricalHeaders={multiSale ? [SALE_COLUMN_HEADER] : undefined}
        />
      )}

      {activeFilterChips.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {activeFilterChips.map((chip) => (
            <Chip key={chip.key} label={chip.label} size="small" onDelete={chip.onRemove} />
          ))}
        </div>
      )}

      {selected.length > 0 && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-[var(--radius-lg)] bg-ink-solid-900 text-white mb-3 flex-wrap">
          <Chip
            label={`${selected.length} lot${selected.length === 1 ? "" : "s"} selected${
              selectionSaleCount > 1 ? ` · ${selectionSaleCount} sales` : ""
            }`}
            size="small"
            sx={{ bgcolor: "rgba(217,182,92,0.18)", color: "var(--brass-light)", fontFamily: "var(--font-mono)" }}
          />
          <div className="flex gap-1.5 ml-auto flex-wrap">
            <Tooltip title={workDisabled ? "Narrow the selection to a single sale to value or worksheet it" : ""}>
              <span>
                <Button
                  size="small"
                  variant="contained"
                  color="primary"
                  disabled={workDisabled || bulkBusy !== null}
                  startIcon={<BoltIcon fontSize="small" />}
                  onClick={(e) => setWorkMenuAnchor(e.currentTarget)}
                >
                  Work on selection…
                </Button>
              </span>
            </Tooltip>
            <Menu anchorEl={workMenuAnchor} open={!!workMenuAnchor} onClose={() => setWorkMenuAnchor(null)}>
              {WORK_SECTIONS.map((s) => (
                <MenuItem key={s.field} dense onClick={() => openWorkSection(s.field)}>
                  {s.label}
                </MenuItem>
              ))}
            </Menu>
            <span className="w-px self-stretch bg-white/15 mx-0.5" />
            {(["SelectBest", "Best", "BelowBest", "Poor"] as const).map((c) => (
              <Button
                key={c}
                size="small"
                variant="outlined"
                disabled={bulkBusy !== null}
                aria-busy={bulkBusy === c}
                startIcon={bulkBusy === c ? <CircularProgress size={14} color="inherit" /> : undefined}
                sx={DARK_BAR_BUTTON_SX}
                onClick={() => bulkClassify(c)}
              >
                {bulkBusy === c ? "Marking…" : `Mark all ${CLASSIFICATION_LABELS[c]}`}
              </Button>
            ))}
            <Button
              size="small"
              variant="outlined"
              disabled={bulkBusy !== null}
              aria-busy={bulkBusy === "clear"}
              startIcon={bulkBusy === "clear" ? <CircularProgress size={14} color="inherit" /> : undefined}
              sx={DARK_BAR_BUTTON_SX}
              onClick={bulkClearNotes}
            >
              {bulkBusy === "clear" ? "Clearing…" : "Clear notes"}
            </Button>
            <span className="w-px self-stretch bg-white/15 mx-0.5" />
            <ExportShareMenu
              lots={selected}
              reportTitle={reportTitle}
              catalogueIdForLot={catalogueIdForLot}
              availableColumns={availableExportColumns}
              defaultColumnIds={exportDefaultColumnIds}
              dark
            />
            <Button size="small" variant="outlined" disabled={bulkBusy !== null} sx={DARK_BAR_BUTTON_SX} onClick={() => setSelected([])}>
              Deselect
            </Button>
          </div>
        </div>
      )}

      {bulkNotice && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-warn bg-warn-light text-[13px]" style={{ color: "var(--warn)" }}>
          {bulkNotice}
          <button
            type="button"
            onClick={() => setBulkNotice(null)}
            className="ml-auto bg-transparent border-none cursor-pointer underline text-[12px]"
            style={{ color: "var(--warn)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {importNotice && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-sage bg-sage-light text-[13px]" style={{ color: "var(--sage-dark)" }}>
          {importNotice}
          <button
            type="button"
            onClick={() => setImportNotice(null)}
            className="ml-auto bg-transparent border-none cursor-pointer underline text-[12px]"
            style={{ color: "var(--sage-dark)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {importError && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px]" style={{ color: "var(--danger)" }}>
          {importError}
          <button
            type="button"
            onClick={() => setImportError(null)}
            className="ml-auto bg-transparent border-none cursor-pointer underline text-[12px]"
            style={{ color: "var(--danger)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {presetNotice && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-sage bg-sage-light text-[13px]" style={{ color: "var(--sage-dark)" }}>
          {presetNotice}
          <button
            type="button"
            onClick={() => setPresetNotice(null)}
            className="ml-auto bg-transparent border-none cursor-pointer underline text-[12px]"
            style={{ color: "var(--sage-dark)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Keep the current grid on screen while a newer selection loads — only the true cold
          start (no lots yet) shows the full loading state, so switching sales never blanks.
          A grid-shaped skeleton reads as "the table is about to appear here" far better than
          a bare loading line — same SkeletonRows primitive other pages already reach for
          (components/shared/SkeletonBlock.tsx), just with enough rows to fill the grid's own
          64vh height so nothing reflows when the real grid mounts underneath it. */}
      {headers.length > 0 && !hasSearched && !searching ? (
        // Nothing is loaded until a search is made: the box below is where the lots appear.
        <div
          ref={emptyBoxRef}
          className="border border-dashed border-border rounded-[var(--radius-lg)] bg-surface flex items-center justify-center text-center px-6"
          style={{ height: emptyBoxHeight ?? "42vh" }}
        >
          <p className="text-[13.5px] text-text-muted m-0 max-w-md">
            Choose your filters, then press <strong>Search</strong> (or Enter). Only the lots that match are loaded.
          </p>
        </div>
      ) : (loadingLots || searching) && lots.length === 0 ? (
        <SkeletonRows rows={12} />
      ) : headers.length > 0 ? (
        <div className={loadingLots || filtering ? "opacity-60 transition-opacity pointer-events-none" : "transition-opacity"}>
          <CatalogueGrid
            lots={filteredLots}
            headers={headers}
            columnMeta={columnMeta}
            hiddenColumns={hiddenColumns}
            onHiddenColumnsChange={setHiddenColumns}
            onViewLot={viewLotDetails}
            onEditLot={editLot}
            onSelectionChanged={setSelected}
          />
        </div>
      ) : null}

      <ValuationDrawer lot={drawerLot} open={drawerOpen} onClose={() => setDrawerOpen(false)} onSaved={handleSaved} />

      <LotViewDialog
        lot={viewLot}
        open={viewOpen}
        onClose={() => setViewOpen(false)}
        onEdit={() => {
          setViewOpen(false);
          if (viewLot) editLot(viewLot);
        }}
      />

      <Dialog open={presetDialogOpen} onClose={() => (savingPreset ? null : setPresetDialogOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Save Filter Preset</DialogTitle>
        <DialogContent>
          <p className="text-[12px] text-text-muted mt-0 mb-3">
            Saves the {activeFilterCount} active filter{activeFilterCount === 1 ? "" : "s"} for {reportTitle} — apply it again anytime from Saved Filters.
          </p>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label="Preset name"
            value={presetName}
            onChange={(e) => setPresetName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && presetName.trim()) savePreset();
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPresetDialogOpen(false)} disabled={savingPreset}>
            Cancel
          </Button>
          <Button variant="contained" onClick={savePreset} disabled={savingPreset || !presetName.trim()}>
            {savingPreset ? "Saving…" : "Save"}
          </Button>
        </DialogActions>
      </Dialog>

    </div>
  );
}
