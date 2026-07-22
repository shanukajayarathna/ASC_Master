"use client";

import CatalogueGrid from "@/components/catalogue/CatalogueGrid";
import FilterPanel from "@/components/catalogue/FilterPanel";
import LotViewDialog from "@/components/catalogue/LotViewDialog";
import ValuationDrawer from "@/components/catalogue/ValuationDrawer";
import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { buildExportColumns, defaultExportColumnIds } from "@/lib/exportColumns";
import {
  emptyColumnFilter,
  filterLots,
  isColumnFilterActive,
  type ColumnFilterState,
  type TicketStatus,
} from "@/lib/lotFilters";
import { combineSales, SALE_COLUMN_HEADER, type CombinedCatalogue } from "@/lib/multiSale";
import type { ClassificationValue, Lot } from "@/types/api";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Badge from "@mui/material/Badge";
import Divider from "@mui/material/Divider";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import FilterListIcon from "@mui/icons-material/FilterList";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import BoltIcon from "@mui/icons-material/Bolt";
import { useRouter } from "next/navigation";
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

// Big enough to hold a full weekly sale (~12k lots) in one fetch, same as the
// Valuation Centre and Worksheet pages.
const LARGE_PAGE_SIZE = 20000;

const EMPTY_COMBINED: CombinedCatalogue = {
  lots: [],
  headers: [],
  columnMeta: {},
  catalogueIdByLot: new Map(),
  saleNames: [],
};

export default function CataloguePage() {
  const router = useRouter();
  const {
    catalogues,
    activeCatalogueId,
    selectCatalogue,
    importFile,
    loading: catalogueLoading,
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
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const [yearFilter, setYearFilter] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  // Guards against a slow sale load overwriting a newer one when the selection changes fast.
  const loadSeq = useRef(0);

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
        const entries = await Promise.all(
          selectedSaleIds.map(async (id) => {
            const [detail, paged] = await Promise.all([
              api.getCatalogue(id),
              api.getLots(id, { pageSize: LARGE_PAGE_SIZE }),
            ]);
            return { id, sourceName: detail.sourceName, detail, lots: paged.rows };
          })
        );
        if (seq !== loadSeq.current) return; // a newer load superseded this one
        const c = combineSales(entries, selectedSaleIds.length > 1);
        setCombined(c);
        if (resetView) {
          setHiddenColumns(
            new Set(Object.entries(c.columnMeta).filter(([, m]) => !m.defaultVisible).map(([h]) => h))
          );
          setColumnFilters({});
          setStatusFilter("");
          setClassificationFilter("");
          setYearFilter("");
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

  const filteredLots = useMemo(
    () =>
      filterLots(lots, {
        search,
        columnFilters,
        status: statusFilter,
        classification: classificationFilter,
        year: yearFilter,
      }),
    [lots, search, columnFilters, statusFilter, classificationFilter, yearFilter]
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
    setDrawerOpen(false);
  };

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
    if (selected.length === 0) return;
    const { updated, skipped } = await api.bulkClassify(selected.map((l) => l.id), classification);
    setBulkNotice(
      skipped > 0
        ? `Classified ${updated.toLocaleString()} lot${updated === 1 ? "" : "s"} — ${skipped.toLocaleString()} skipped with no valuation yet.`
        : null
    );
    await reload();
    setSelected([]);
  };

  const bulkClearNotes = async () => {
    if (selected.length === 0) return;
    await api.bulkClearNotes(selected.map((l) => l.id));
    await reload();
    setSelected([]);
  };

  if (!activeCatalogueId) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Catalogue Manager</h1>
        <p className="text-[13px] text-text-muted mb-6 max-w-xl">
          Upload a lot catalogue to begin — search, filter, value and dictate remarks for every lot.
        </p>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const f = e.dataTransfer.files[0];
            if (f) handleFile(f);
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`max-w-2xl mx-auto border-2 border-dashed rounded-lg bg-surface p-14 text-center cursor-pointer transition-colors ${
            dragOver ? "border-sage bg-sage-light" : "border-brass"
          }`}
        >
          <h2 className="font-display text-2xl text-text-strong mb-2">Drop your catalogue here</h2>
          <p className="text-[13.5px] text-text-muted mb-5">
            Click to browse, or drag an Excel file in. Parsed and stored server-side in MongoDB via the ASP.NET Core API.
          </p>
          <Button variant="contained" onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }}>
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
        </div>

        {(importError || catalogueError) && (
          <p className="max-w-2xl mx-auto mt-4 text-center text-danger text-sm">{importError ?? catalogueError}</p>
        )}
        {catalogueLoading && <p className="text-center text-text-muted text-sm mt-4">Importing…</p>}
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-start justify-between gap-4 flex-wrap mb-4">
        <div>
          <h1 className="font-display text-2xl font-bold text-text-strong mb-1">Catalogue Manager</h1>
          <p className="text-[13px] text-text-muted m-0">
            {reportTitle} · {lots.length.toLocaleString()} lots · {headers.length} columns
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
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
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileOutlinedIcon fontSize="small" />}
            onClick={() => fileInputRef.current?.click()}
          >
            Import file
          </Button>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xls,.xlsx,.csv,.ods"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleImport(f);
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
          sx={{ width: 340 }}
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
        <span className="text-[12.5px] text-text-muted font-mono ml-auto">
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
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-ink-solid-900 text-white mb-3 flex-wrap">
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
                  disabled={workDisabled}
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
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("SelectBest")}>
              Mark all Select Best
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("Best")}>
              Mark all Best
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("BelowBest")}>
              Mark all Below Best
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("Poor")}>
              Mark all Poor
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={bulkClearNotes}>
              Clear notes
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
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => setSelected([])}>
              Deselect
            </Button>
          </div>
        </div>
      )}

      {bulkNotice && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-warn-light text-[12.5px]" style={{ color: "var(--warn)" }}>
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
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-sage-light text-[12.5px]" style={{ color: "var(--sage-dark)" }}>
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
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-md bg-danger-light text-[12.5px]" style={{ color: "var(--danger)" }}>
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

      {loadingLots ? (
        <p className="text-text-muted text-sm">Loading lots…</p>
      ) : headers.length > 0 ? (
        <CatalogueGrid
          lots={filteredLots}
          headers={headers}
          columnMeta={columnMeta}
          hiddenColumns={hiddenColumns}
          onViewLot={viewLotDetails}
          onEditLot={editLot}
          onSelectionChanged={setSelected}
        />
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

    </div>
  );
}
