"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import CatalogueGrid from "@/components/catalogue/CatalogueGrid";
import FilterPanel from "@/components/catalogue/FilterPanel";
import LotViewDialog from "@/components/catalogue/LotViewDialog";
import ValuationDrawer from "@/components/catalogue/ValuationDrawer";
import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { buildExportColumns, defaultExportColumnIds } from "@/lib/exportColumns";
import {
  emptyColumnFilter,
  filterLots,
  isColumnFilterActive,
  type ColumnFilterState,
  type StoredFilterState,
  type TicketStatus,
} from "@/lib/lotFilters";
import { combineSales, SALE_COLUMN_HEADER, type CombinedCatalogue } from "@/lib/multiSale";
import { invalidateSale, loadSale, patchCachedLot } from "@/lib/saleCache";
import type { ClassificationValue, Lot } from "@/types/api";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Badge from "@mui/material/Badge";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Divider from "@mui/material/Divider";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import FilterListIcon from "@mui/icons-material/FilterList";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import BoltIcon from "@mui/icons-material/Bolt";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";

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
  const [salesMenuAnchor, setSalesMenuAnchor] = useState<HTMLElement | null>(null);

  const [combined, setCombined] = useState<CombinedCatalogue>(EMPTY_COMBINED);
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
  const [filtersOpen, setFiltersOpen] = useState(true);
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
  const { lots, headers, columnMeta, catalogueIdByLot, saleNames } = combined;

  // Fetch every selected sale (headers + lots) and pool them. `resetView` clears filters and
  // column visibility to the pooled defaults — done when the sale selection changes, but not
  // on a plain data refresh (e.g. after a bulk classify) so the current filters survive.
  const loadCombined = useCallback(
    async (resetView: boolean) => {
      if (selectedSaleIds.length === 0) {
        setCombined(EMPTY_COMBINED);
        return;
      }
      const seq = ++loadSeq.current;
      setLoadingLots(true);
      try {
        // Already-loaded sales come straight from the cache; only sales new to the pool hit
        // the network, so growing/narrowing a multi-sale selection is near-instant.
        const entries = await Promise.all(selectedSaleIds.map((id) => loadSale(id)));
        if (seq !== loadSeq.current) return; // a newer load superseded this one
        const c = combineSales(entries, selectedSaleIds.length > 1);
        setCombined(c);
        if (resetView) {
          setHiddenColumns(
            new Set(Object.entries(c.columnMeta).filter(([, m]) => !m.defaultVisible).map(([h]) => h))
          );
          const pending = pendingPresetFilters.current;
          pendingPresetFilters.current = null;
          setColumnFilters(pending?.columnFilters ?? {});
          setStatusFilter(pending?.status ?? "");
          setClassificationFilter(pending?.classification ?? "");
          setYearFilter(pending?.year ?? "");
          if (pending) setSearch(pending.search);
          setSelected([]);
        }
      } finally {
        if (seq === loadSeq.current) setLoadingLots(false);
      }
    },
    [selectedSaleIds]
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
    setYearFilter("");
    setSearch("");
  };

  // The full filter pass below walks every pooled lot, which is far too slow to run inside
  // the same render as a keystroke — so it runs against these deferred copies instead: the
  // keystroke paints immediately, and the pass catches up in an interruptible background
  // render. While the two disagree, `filtering` drives the same Updating… pill and dimmed
  // grid treatment a sale reload already uses.
  const dSearch = useDeferredValue(search);
  const dColumnFilters = useDeferredValue(columnFilters);
  const dStatusFilter = useDeferredValue(statusFilter);
  const dClassificationFilter = useDeferredValue(classificationFilter);
  const dYearFilter = useDeferredValue(yearFilter);
  const filtering =
    search !== dSearch ||
    columnFilters !== dColumnFilters ||
    statusFilter !== dStatusFilter ||
    classificationFilter !== dClassificationFilter ||
    yearFilter !== dYearFilter;

  const filteredLots = useMemo(
    () =>
      filterLots(lots, {
        search: dSearch,
        columnFilters: dColumnFilters,
        status: dStatusFilter,
        classification: dClassificationFilter,
        year: dYearFilter,
      }),
    [lots, dSearch, dColumnFilters, dStatusFilter, dClassificationFilter, dYearFilter]
  );

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
    if (yearFilter) {
      chips.push({ key: "year", label: `Year: ${yearFilter}`, onRemove: () => setYearFilter("") });
    }
    return chips;
  }, [columnFilters, statusFilter, classificationFilter, yearFilter, columnMeta]);

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
          <PageHeader title="Catalogue Manager" />
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
          title="Catalogue Manager"
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
        title="Catalogue Manager"
        subtitle={`${reportTitle} · ${lots.length.toLocaleString()} lots · ${headers.length} columns`}
        actions={
          <>
            <Badge badgeContent={multiSale ? selectedSaleIds.length : 0} color="primary" invisible={!multiSale}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<LayersOutlinedIcon fontSize="small" />}
                onClick={(e) => setSalesMenuAnchor(e.currentTarget)}
              >
                Sales
              </Button>
            </Badge>
            <ExportShareMenu
              lots={filteredLots}
              reportTitle={reportTitle}
              catalogueIdForLot={catalogueIdForLot}
              availableColumns={availableExportColumns}
              defaultColumnIds={exportDefaultColumnIds}
            />
            <Button
              variant="outlined"
              size="small"
              startIcon={<ViewColumnIcon fontSize="small" />}
              onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
            >
              Columns
            </Button>
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

        {/* Multi-sale picker: pool several weekly sales into one filterable / exportable set. */}
        <Menu anchorEl={salesMenuAnchor} open={!!salesMenuAnchor} onClose={() => setSalesMenuAnchor(null)}>
          <div className="px-3.5 pt-1 pb-2 flex items-center gap-2">
            <span className="text-[12px] text-text-muted font-mono">
              {selectedSaleIds.length} of {catalogues.length} sales
            </span>
            <div className="ml-auto flex gap-1">
              <Button size="small" onClick={() => setSelectedSaleIds(catalogues.map((c) => c.id))}>
                All
              </Button>
              <Button size="small" onClick={() => activeCatalogueId && setSelectedSaleIds([activeCatalogueId])}>
                One
              </Button>
            </div>
          </div>
          <Divider />
          {catalogues.map((c) => (
            <MenuItem key={c.id} onClick={() => toggleSale(c.id)} dense>
              <Checkbox checked={selectedSaleIds.includes(c.id)} size="small" />
              <ListItemText primary={c.sourceName} secondary={`${c.rowCount.toLocaleString()} lots`} />
            </MenuItem>
          ))}
        </Menu>

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
          // Full width on phones (it gets its own wrapped row), fixed on larger screens.
          sx={{ width: { xs: "100%", sm: 340 } }}
        />
        <Badge badgeContent={activeFilterCount} color="error" invisible={activeFilterCount === 0}>
          <Button
            variant={filtersOpen ? "contained" : "outlined"}
            size="small"
            color={filtersOpen ? "primary" : undefined}
            startIcon={<FilterListIcon fontSize="small" />}
            onClick={() => setFiltersOpen((o) => !o)}
          >
            Filters
          </Button>
        </Badge>
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
          {((loadingLots && lots.length > 0) || filtering) && (
            <span className="inline-flex items-center gap-1 text-brass">
              <span className="w-1.5 h-1.5 rounded-full bg-brass animate-pulse" />
              Updating…
            </span>
          )}
          {filteredLots.length.toLocaleString()} of {lots.length.toLocaleString()} lots
        </span>
      </div>

      {filtersOpen && headers.length > 0 && (
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
          onYearChange={setYearFilter}
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
          start (no lots yet) shows the full loading state, so switching sales never blanks. */}
      {loadingLots && lots.length === 0 ? (
        <p className="text-text-muted text-sm">Loading lots…</p>
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
