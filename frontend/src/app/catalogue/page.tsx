"use client";

import CatalogueGrid from "@/components/catalogue/CatalogueGrid";
import ValuationDrawer from "@/components/catalogue/ValuationDrawer";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { ClassificationValue, Lot } from "@/types/api";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Chip from "@mui/material/Chip";
import { useCallback, useEffect, useRef, useState } from "react";

const LARGE_PAGE_SIZE = 5000;

export default function CataloguePage() {
  const { activeCatalogueId, activeCatalogue, importFile, loading: catalogueLoading, error: catalogueError } = useCatalogue();
  const [lots, setLots] = useState<Lot[]>([]);
  const [loadingLots, setLoadingLots] = useState(false);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Lot[]>([]);
  const [drawerLot, setDrawerLot] = useState<Lot | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
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

  const handleFile = async (file: File) => {
    setImportError(null);
    try {
      await importFile(file);
    } catch (e) {
      setImportError(e instanceof Error ? e.message : "Import failed");
    }
  };

  const openTicket = (lot: Lot) => {
    setDrawerLot(lot);
    setDrawerOpen(true);
  };

  const handleSaved = (updated: Lot) => {
    setLots((prev) => prev.map((l) => (l.id === updated.id ? updated : l)));
    setDrawerOpen(false);
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
            Click to browse, or drag an Excel file in. Parsed and stored server-side in PostgreSQL via the ASP.NET Core API.
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
        <Button variant="outlined" size="small" onClick={() => fileInputRef.current?.click()}>
          Load a different file
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
      </div>

      <TextField
        placeholder="Search across every column…"
        size="small"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        className="mb-3"
        sx={{ width: 340 }}
      />

      {selected.length > 0 && (
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-md bg-ink-900 text-white mb-3 flex-wrap">
          <Chip
            label={`${selected.length} lot${selected.length === 1 ? "" : "s"} selected`}
            size="small"
            sx={{ bgcolor: "rgba(217,182,92,0.18)", color: "var(--brass-light)", fontFamily: "var(--font-mono)" }}
          />
          <div className="flex gap-1.5 ml-auto flex-wrap">
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("Best")}>
              Mark Best
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("BelowBest")}>
              Mark Below Best
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={() => bulkClassify("Poor")}>
              Mark Poor
            </Button>
            <Button size="small" variant="outlined" sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.3)" }} onClick={bulkClearNotes}>
              Clear notes
            </Button>
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
          lots={lots}
          headers={activeCatalogue.headers}
          columnMeta={activeCatalogue.columnMeta}
          onOpenTicket={openTicket}
          onSelectionChanged={setSelected}
          quickFilterText={search}
        />
      ) : null}

      <ValuationDrawer lot={drawerLot} open={drawerOpen} onClose={() => setDrawerOpen(false)} onSaved={handleSaved} />
    </div>
  );
}
