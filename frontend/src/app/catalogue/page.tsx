"use client";

import CatalogueGrid from "@/components/catalogue/CatalogueGrid";
import FilterPanel from "@/components/catalogue/FilterPanel";
import LotViewDialog from "@/components/catalogue/LotViewDialog";
import ValuationDrawer from "@/components/catalogue/ValuationDrawer";
import ExportShareMenu from "@/components/catalogue/ExportShareMenu";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import {
  emptyColumnFilter,
  filterLots,
  isColumnFilterActive,
  type ColumnFilterState,
  type TicketStatus,
} from "@/lib/lotFilters";
import type { ClassificationValue, Lot } from "@/types/api";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import Badge from "@mui/material/Badge";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import FilterListIcon from "@mui/icons-material/FilterList";
import BoltIcon from "@mui/icons-material/Bolt";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

const VALUATION_HANDOFF_KEY = "asc:valuation:pending";
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

const LARGE_PAGE_SIZE = 5000;

export default function CataloguePage() {
  const router = useRouter();
  const { activeCatalogueId, activeCatalogue, importFile, loading: catalogueLoading, error: catalogueError } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
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
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnsMenuAnchor, setColumnsMenuAnchor] = useState<HTMLElement | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [columnFilters, setColumnFilters] = useState<Record<string, ColumnFilterState>>({});
  const [statusFilter, setStatusFilter] = useState<TicketStatus | "">("");
  const [classificationFilter, setClassificationFilter] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadLots = useCallback(async () => {
    if (!activeCatalogueId) {
      setLots([]);
      return;
    }
    setLoadingLots(true);
    try {
      const paged = await api.getLots(activeCatalogueId, { pageSize: LARGE_PAGE_SIZE });
      setLots(paged.rows);
    } finally {
      setLoadingLots(false);
    }
  }, [activeCatalogueId]);

  useEffect(() => {
    // Data-fetch-on-dependency-change effect (loadLots synchronously clears lots for the
    // no-catalogue case before its async fetch), not the derived-state anti-pattern the rule targets.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadLots();
  }, [loadLots]);

  useEffect(() => {
    // Resets column visibility and all filters to defaults whenever the active catalogue changes.
    const meta = activeCatalogue?.columnMeta;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHiddenColumns(
      meta ? new Set(Object.entries(meta).filter(([, m]) => !m.defaultVisible).map(([h]) => h)) : new Set()
    );
    setColumnFilters({});
    setStatusFilter("");
    setClassificationFilter("");
  }, [activeCatalogue?.id, activeCatalogue?.columnMeta]);

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
  };

  const filteredLots = useMemo(
    () =>
      filterLots(lots, {
        search,
        columnFilters,
        status: statusFilter,
        classification: classificationFilter,
      }),
    [lots, search, columnFilters, statusFilter, classificationFilter]
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
            : `${header}: "${f.value}"`;
      chips.push({
        key: `col-${header}`,
        label,
        onRemove: () => setColumnFilters((prev) => ({ ...prev, [header]: emptyColumnFilter(activeCatalogue?.columnMeta[header]) })),
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
  }, [columnFilters, statusFilter, classificationFilter, activeCatalogue?.columnMeta]);

  const activeFilterCount = activeFilterChips.length;

  const handleFile = async (file: File) => {
    setImportError(null);
    try {
      await importFile(file);
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
    setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDrawerOpen(false);
  };

  // Hands the current selection off to the right workspace for the chosen section —
  // Valuation has its own dedicated page; every other section shares the Lot Worksheet.
  const openWorkSection = (section: WorksheetField | "valuation") => {
    setWorkMenuAnchor(null);
    if (!activeCatalogueId || selected.length === 0) return;
    const lotIds = selected.map((l) => l.id);
    if (section === "valuation") {
      window.sessionStorage.setItem(VALUATION_HANDOFF_KEY, JSON.stringify({ catalogueId: activeCatalogueId, lotIds }));
      router.push("/valuation");
    } else {
      window.sessionStorage.setItem(
        WORKSHEET_HANDOFF_KEY,
        JSON.stringify({ catalogueId: activeCatalogueId, lotIds, field: section })
      );
      router.push("/worksheet");
    }
  };

  const bulkClassify = async (classification: ClassificationValue) => {
    if (selected.length === 0) return;
    await api.bulkClassify(selected.map((l) => l.id), classification);
    await loadLots();
    setSelected([]);
  };

  const bulkClearNotes = async () => {
    if (selected.length === 0) return;
    await api.bulkClearNotes(selected.map((l) => l.id));
    await loadLots();
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
            {activeCatalogue?.sourceName} · {activeCatalogue?.rowCount.toLocaleString()} lots · {activeCatalogue?.headers.length} columns
          </p>
        </div>
        <div className="flex gap-2">
          <ExportShareMenu
            catalogueId={activeCatalogueId}
            catalogueName={activeCatalogue?.sourceName ?? "Catalogue"}
            lots={filteredLots}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<ViewColumnIcon fontSize="small" />}
            onClick={(e) => setColumnsMenuAnchor(e.currentTarget)}
          >
            Columns
          </Button>
          <Button variant="outlined" size="small" onClick={() => fileInputRef.current?.click()}>
            Load a different file
          </Button>
        </div>
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
        <Menu anchorEl={columnsMenuAnchor} open={!!columnsMenuAnchor} onClose={() => setColumnsMenuAnchor(null)}>
          {activeCatalogue?.headers.map((h) => (
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

      {filtersOpen && activeCatalogue && (
        <FilterPanel
          headers={activeCatalogue.headers}
          columnMeta={activeCatalogue.columnMeta}
          columnFilters={columnFilters}
          onColumnFilterChange={setColumnFilter}
          status={statusFilter}
          onStatusChange={setStatusFilter}
          classification={classificationFilter}
          onClassificationChange={setClassificationFilter}
          onClearAll={clearAllFilters}
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
            label={`${selected.length} lot${selected.length === 1 ? "" : "s"} selected`}
            size="small"
            sx={{ bgcolor: "rgba(217,182,92,0.18)", color: "var(--brass-light)", fontFamily: "var(--font-mono)" }}
          />
          <div className="flex gap-1.5 ml-auto flex-wrap">
            <Button
              size="small"
              variant="contained"
              color="primary"
              startIcon={<BoltIcon fontSize="small" />}
              onClick={(e) => setWorkMenuAnchor(e.currentTarget)}
            >
              Work on selection…
            </Button>
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
            <ExportShareMenu catalogueId={activeCatalogueId} catalogueName={activeCatalogue?.sourceName ?? "Catalogue"} lots={selected} dark />
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => setSelected([])}>
              Deselect
            </Button>
          </div>
        </div>
      )}

      {loadingLots ? (
        <p className="text-text-muted text-sm">Loading lots…</p>
      ) : activeCatalogue ? (
        <CatalogueGrid
          lots={filteredLots}
          headers={activeCatalogue.headers}
          columnMeta={activeCatalogue.columnMeta}
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
