"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { WorksheetFacets, WorksheetRow } from "@/types/api";
import {
  displayValuationForExport as displayValuation,
  exportWorksheetPdf,
  fmt2,
  type WorksheetPdfColumn,
} from "@/lib/worksheetPdf";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SearchIcon from "@mui/icons-material/Search";
import SimCardDownloadOutlinedIcon from "@mui/icons-material/SimCardDownloadOutlined";
import ViewColumnOutlinedIcon from "@mui/icons-material/ViewColumnOutlined";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Divider from "@mui/material/Divider";
import FormControlLabel from "@mui/material/FormControlLabel";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import { useEffect, useMemo, useRef, useState } from "react";

/** Reads a previous in-progress worksheet from this browser (SSR-safe: returns empty on the
 *  server). Same idea as the original tool's session persistence — nothing here ever touches
 *  the backend. */
/** Collapses rows saved from before duplicate-safe loading existed: any rows that are "the same
 *  lot" by rowSignature (see below) get merged into one, with later-saved fields (e.g. an Invoice
 *  No that only showed up in a later reload) winning over earlier blanks — so a legacy pair like
 *  "lot without invoice" + "lot with invoice" collapses back into a single, complete row instead
 *  of surfacing as two visible duplicates every time the session reloads. */
function dedupeStoredRows(rows: Row[]): Row[] {
  const bySignature = new Map<string, Row>();
  const order: string[] = [];
  for (const row of rows) {
    const sig = rowSignature(row);
    const prior = bySignature.get(sig);
    if (!prior) {
      order.push(sig);
      bySignature.set(sig, row);
      continue;
    }
    bySignature.set(sig, {
      ...prior,
      ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== null && v !== "")),
      extra: { ...(prior.extra ?? {}), ...(row.extra ?? {}) },
    });
  }
  return order.map((sig) => bySignature.get(sig)!);
}

function loadSession(): { rows: Row[]; visibleColumns: string[] } {
  if (typeof window === "undefined") return { rows: [], visibleColumns: ALL_COLUMNS };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { rows: [], visibleColumns: ALL_COLUMNS };
    const saved = JSON.parse(raw) as { rows?: Row[]; visibleColumns?: string[] };
    return {
      rows: Array.isArray(saved.rows) ? dedupeStoredRows(saved.rows) : [],
      visibleColumns: Array.isArray(saved.visibleColumns) ? saved.visibleColumns : ALL_COLUMNS,
    };
  } catch {
    return { rows: [], visibleColumns: ALL_COLUMNS };
  }
}

interface Row extends WorksheetRow {
  id: string;
}

// Broker-first, matching the original standalone Worksheet's DEFAULT_COLUMNS order exactly.
type ColumnKey = "broker" | "lotNumber" | "sellingMark" | "grade" | "bags" | "netWeight" | "totalWeight" | "remarks";

const COLUMN_LABELS: Record<ColumnKey, string> = {
  broker: "Broker",
  lotNumber: "Lot No",
  sellingMark: "Selling Mark",
  grade: "Grade",
  bags: "Bags",
  netWeight: "Net Weight",
  totalWeight: "Total Weight",
  remarks: "Remarks",
};

const ALL_COLUMNS = Object.keys(COLUMN_LABELS) as ColumnKey[];
const SESSION_KEY = "asc_worksheet_session_v1";
const VALUATION_RANGE_RE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/;

// Any "extra" (unrecognised) column whose header looks invoice-like is auto-shown the moment
// it's detected, same as the original's AUTO_SHOW_EXTRA_PATTERNS — an invoice number is useful
// enough on sight that it shouldn't need a manual toggle.
const AUTO_SHOW_EXTRA_PATTERNS = [/invoice/i, /\binv\b/i];
const EXTRA_PREFIX = "extra:";
const extraColKey = (rawKey: string) => `${EXTRA_PREFIX}${rawKey}`;

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default order" },
  { value: "grade-asc", label: "Grade (A–Z)" },
  { value: "grade-desc", label: "Grade (Z–A)" },
  { value: "totalWeight-desc", label: "Weight (High–Low)" },
  { value: "totalWeight-asc", label: "Weight (Low–High)" },
  { value: "valuation-desc", label: "Valuation (High–Low)" },
  { value: "valuation-asc", label: "Valuation (Low–High)" },
  { value: "totalProceeds-desc", label: "Total Proceeds (High–Low)" },
  { value: "totalProceeds-asc", label: "Total Proceeds (Low–High)" },
];

function sortValueOf(r: Row, key: string): number | string {
  switch (key) {
    case "grade":
      return r.grade ?? "";
    case "totalWeight":
      return r.totalWeight ?? 0;
    case "valuation":
      return r.valuation ?? 0;
    case "totalProceeds":
      return (r.valuation ?? 0) * (r.totalWeight ?? 0);
    default:
      return "";
  }
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `r_${Date.now()}_${Math.random()}`;
}

function toRow(w: WorksheetRow): Row {
  return { ...w, id: newId() };
}

/** Identifies "the same lot" across two rows — used only to collapse duplicates left over in a
 *  browser session saved before duplicate-safe loading existed (see dedupeStoredRows above). */
function rowSignature(w: WorksheetRow): string {
  return [w.lotNumber, w.broker, w.sellingMark, w.grade, w.netWeight, w.totalWeight]
    .map((v) => (v ?? "").toString().trim().toLowerCase())
    .join("|");
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ported exactly from the original standalone Worksheet's parseValuationInput: a range like
 *  "1200-1300" keeps its full text for display, but the LOWER value — never the midpoint — is
 *  what feeds Total Proceeds/every total/the average/sorting. The lower number always sorts
 *  first regardless of typing order ("1400-1200" becomes "1200.00 - 1400.00"). A plain number
 *  is parsed leniently (parseFloat-style) so a value that isn't fully typed yet doesn't just
 *  vanish. Empty input is 0, exactly like the original (never null) — falsy either way wherever
 *  it's checked (e.g. "entered values only"). */
function parseValuationInput(text: string): { valuation: number; valuationRangeText: string | null } {
  const raw = text.trim();
  if (!raw) return { valuation: 0, valuationRangeText: null };
  const rangeMatch = raw.match(VALUATION_RANGE_RE);
  if (rangeMatch) {
    const a = Number(rangeMatch[1]);
    const b = Number(rangeMatch[2]);
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    return { valuation: lo, valuationRangeText: `${lo.toFixed(2)} - ${hi.toFixed(2)}` };
  }
  const n = parseFloat(raw.replace(/,/g, ""));
  return { valuation: Number.isFinite(n) ? n : 0, valuationRangeText: null };
}

/** No letters allowed in the Valuation box — only digits, a decimal point and "-" (the range
 *  separator) survive, same character set the original's live 'input' handler enforces (no
 *  spaces either; those only appear in the reformatted display after the field is committed). */
function sanitizeValuationInput(text: string): string {
  return text.replace(/[^0-9.-]/g, "");
}

export default function WorksheetPage() {
  const { catalogues } = useCatalogue();

  const [rows, setRows] = useState<Row[]>(() => loadSession().rows);
  // Fixed column keys (broker/lotNumber/…) plus "extra:<raw header>" for any detected extra
  // column the user has toggled on — see extraColKey/isExtraColKey above.
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => loadSession().visibleColumns);
  const [search, setSearch] = useState("");
  const [excludeUnvalued, setExcludeUnvalued] = useState(false);
  // While a Valuation box is focused, it shows exactly what's being typed (raw, unformatted) —
  // the canonical formatted text only "snaps in" on blur. Same UX as the original tool, which
  // leaves the DOM input alone on every keystroke and only rewrites it in its blur handler.
  const [editingValuation, setEditingValuation] = useState<Record<string, string>>({});
  const [sortValue, setSortValue] = useState("");

  // Lines taken out of the working table, newest last, each kept with the position it was
  // removed from so "Restore removed lines" can put every one back exactly where it was —
  // ported from the original's removedRows/restoreAllRemovedRows.
  const [removedRows, setRemovedRows] = useState<{ index: number; row: Row }[]>([]);
  const [undoRow, setUndoRow] = useState<Row | null>(null);

  const [saleCatalogueId, setSaleCatalogueId] = useState("");
  const [broker, setBroker] = useState("");
  const [factory, setFactory] = useState<string[]>([]);
  const [facets, setFacets] = useState<WorksheetFacets | null>(null);
  const [loadingSale, setLoadingSale] = useState(false);

  const [uploading, setUploading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [downloadingTemplate, setDownloadingTemplate] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [columnsAnchor, setColumnsAnchor] = useState<HTMLElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const valuationInputRefs = useRef(new Map<string, HTMLInputElement>());
  const remarksInputRefs = useRef(new Map<string, HTMLInputElement>());

  // Persist the working table to this browser on every change — nothing here ever touches the
  // backend, matching the original standalone tool's client-only session persistence.
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ rows, visibleColumns }));
    } catch {
      // storage full/unavailable — session just won't survive a refresh
    }
  }, [rows, visibleColumns]);

  // Every broker/MF-code/factory-name actually present in the picked sale, so the fields below
  // can offer real options instead of blind free text — fetched once per sale, filtered
  // client-side as the user types (see the Autocomplete components below).
  //
  // Guarded against out-of-order responses: if the sale is switched again before this fetch
  // resolves, an older request finishing LATER than the newer one must not be allowed to
  // overwrite the newer sale's facets with the previous sale's data (a real race — request
  // latency isn't guaranteed to match request order, and different sales parse at very
  // different speeds). latestRequestRef always holds the most recently *requested* sale id;
  // a response only gets applied if it's still the latest one by the time it lands.
  const latestFacetsRequestRef = useRef<string | null>(null);
  useEffect(() => {
    latestFacetsRequestRef.current = saleCatalogueId || null;
    if (!saleCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFacets(null);
      return;
    }
    const requestedFor = saleCatalogueId;
    api
      .getWorksheetFacets(requestedFor)
      .then((result) => {
        if (latestFacetsRequestRef.current === requestedFor) setFacets(result);
      })
      .catch(() => {
        if (latestFacetsRequestRef.current === requestedFor) setFacets(null);
      });
  }, [saleCatalogueId]);

  const factoryOptions = useMemo(
    () =>
      (facets?.factories ?? [])
        .map((f) => (f.code && f.name ? `${f.code} — ${f.name}` : f.code || f.name || ""))
        .filter(Boolean),
    [facets]
  );

  // Every distinct extra-column header seen across all loaded rows (e.g. "Invoice No"), in
  // first-seen order — these are what the Columns menu offers beyond the fixed 7.
  const extraColumnKeys = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows) {
      if (!r.extra) continue;
      for (const key of Object.keys(r.extra)) if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [rows]);

  // Invoice-like extra columns are shown the moment they're detected, same as the original's
  // AUTO_SHOW_EXTRA_PATTERNS — everything else stays an opt-in toggle.
  useEffect(() => {
    const toShow = extraColumnKeys.filter(
      (key) => AUTO_SHOW_EXTRA_PATTERNS.some((re) => re.test(key)) && !visibleColumns.includes(extraColKey(key))
    );
    if (toShow.length === 0) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setVisibleColumns((cols) => [...cols, ...toShow.map(extraColKey)]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [extraColumnKeys]);

  const loadFromSale = async () => {
    if (!saleCatalogueId) {
      setError("Pick a sale first.");
      return;
    }
    setLoadingSale(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.getWorksheetLots(saleCatalogueId, broker.trim(), factory);
      // Every load replaces the table outright — otherwise stale rows from a previous sale
      // linger mixed in with the new load and look like they never refreshed.
      setRows(result.rows.map(toRow));
      setEditingValuation({});
      setRemovedRows([]);
      setUndoRow(null);
      setNotice(
        result.truncated
          ? `Loaded the first ${result.rows.length} of ${result.totalMatches} matching lots — narrow the filters to see the rest.`
          : `Loaded ${result.rows.length} lot(s).`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't load lots from that sale");
    } finally {
      setLoadingSale(false);
    }
  };

  const uploadFile = async (file: File) => {
    setUploading(true);
    setError(null);
    setNotice(null);
    try {
      const result = await api.importWorksheetFile(file);
      // Every load replaces the table outright — otherwise stale rows from a previous load
      // linger mixed in with the new one and look like they never refreshed.
      setRows(result.rows.map(toRow));
      setEditingValuation({});
      setRemovedRows([]);
      setUndoRow(null);
      setNotice(
        result.skippedRows
          ? `Loaded ${result.rows.length} row(s) from "${result.fileName}" (${result.skippedRows} incomplete row(s) skipped).`
          : `Loaded ${result.rows.length} row(s) from "${result.fileName}".`
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const updateRow = (id: string, patch: Partial<WorksheetRow>) => {
    setRows((r) => r.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  };

  // Soft-remove with an 8s Undo toast, matching the original's showUndoToast — the removed line
  // is held (with the position it came from) so it can go back exactly where it was.
  const removeRow = (id: string) => {
    const idx = rows.findIndex((r) => r.id === id);
    if (idx === -1) return;
    const row = rows[idx];
    setRemovedRows((rr) => [...rr, { index: idx, row }]);
    setRows((r) => r.filter((x) => x.id !== id));
    setUndoRow(row);
  };

  const restoreRow = (id: string) => {
    const at = removedRows.findIndex((e) => e.row.id === id);
    if (at === -1) return;
    const entry = removedRows[at];
    setRows((cur) => {
      const next = [...cur];
      next.splice(Math.min(entry.index, next.length), 0, entry.row);
      return next;
    });
    setRemovedRows((rr) => rr.filter((_, i) => i !== at));
  };

  const restoreAllRemoved = () => {
    if (!removedRows.length) return;
    setRows((cur) => {
      const next = [...cur];
      for (let i = removedRows.length - 1; i >= 0; i--) {
        const entry = removedRows[i];
        next.splice(Math.min(entry.index, next.length), 0, entry.row);
      }
      return next;
    });
    setRemovedRows([]);
    setUndoRow(null);
  };

  const clearValuations = () => {
    if (!rows.length) return;
    if (!window.confirm("Clear all entered valuations? This cannot be undone.")) return;
    setRows((r) => r.map((row) => ({ ...row, valuation: 0, valuationRangeText: null })));
    setEditingValuation({});
    setNotice("All valuations cleared.");
  };

  const resetWorksheet = () => {
    if (!rows.length) return;
    if (!window.confirm("Reset the current worksheet to the default state? This will clear the loaded data and any entered valuations.")) return;
    setRows([]);
    setRemovedRows([]);
    setUndoRow(null);
    setVisibleColumns(ALL_COLUMNS);
    setSearch("");
    setSortValue("");
    setNotice(null);
    setError(null);
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  };

  const downloadTemplate = async () => {
    setDownloadingTemplate(true);
    setError(null);
    try {
      const blob = await api.downloadWorksheetTemplate("Valuation");
      triggerDownload(blob, "tea-auction-template.xlsx");
      setNotice("Template downloaded.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not download the template");
    } finally {
      setDownloadingTemplate(false);
    }
  };

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.lotNumber, r.broker, r.sellingMark, r.grade].some((v) => (v ?? "").toLowerCase().includes(q))
    );
  }, [rows, search]);

  const filteredSortedRows = useMemo(() => {
    if (!sortValue) return filteredRows;
    const [key, dir] = sortValue.split("-");
    return [...filteredRows].sort((a, b) => {
      const av = sortValueOf(a, key);
      const bv = sortValueOf(b, key);
      if (typeof av === "number" && typeof bv === "number") return dir === "asc" ? av - bv : bv - av;
      const cmp = String(av).localeCompare(String(bv));
      return dir === "asc" ? cmp : -cmp;
    });
  }, [filteredRows, sortValue]);

  const avgEligibleRows = useMemo(() => (excludeUnvalued ? rows.filter((r) => (r.valuation ?? 0) > 0) : rows), [
    rows,
    excludeUnvalued,
  ]);

  const totals = useMemo(() => {
    const totalQty = rows.reduce((sum, r) => sum + (r.totalWeight ?? 0), 0);
    const totalValue = rows.reduce((sum, r) => sum + (r.valuation ?? 0) * (r.totalWeight ?? 0), 0);
    const avgQty = avgEligibleRows.reduce((sum, r) => sum + (r.totalWeight ?? 0), 0);
    const avgValue = avgEligibleRows.reduce((sum, r) => sum + (r.valuation ?? 0) * (r.totalWeight ?? 0), 0);
    return { totalQty, totalValue, avg: avgQty > 0 ? avgValue / avgQty : 0 };
  }, [rows, avgEligibleRows]);

  const saleLabel = catalogues.find((c) => c.id === saleCatalogueId)?.sourceName ?? null;

  // The extra columns currently shown, in first-seen order — drives both exports, exactly like
  // the original's getActiveColumns() driving its Excel and PDF exports off the same state.
  const activeExtraKeys = useMemo(
    () => extraColumnKeys.filter((key) => visibleColumns.includes(extraColKey(key))),
    [extraColumnKeys, visibleColumns]
  );

  const exportExcel = async () => {
    setExporting(true);
    setError(null);
    try {
      const blob = await api.exportWorksheetExcel(
        "Worksheet",
        saleLabel,
        rows.map(
          (r): WorksheetRow => ({
            lotNumber: r.lotNumber,
            broker: r.broker,
            sellingMark: r.sellingMark,
            grade: r.grade,
            bags: r.bags,
            netWeight: r.netWeight,
            totalWeight: r.totalWeight,
            valuation: r.valuation,
            valuationRangeText: r.valuationRangeText,
            remarks: r.remarks,
            extra: r.extra,
          })
        ),
        excludeUnvalued,
        activeExtraKeys
      );
      triggerDownload(blob, "Worksheet.xlsx");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const [exportingPdf, setExportingPdf] = useState(false);
  const exportPdf = async () => {
    setExportingPdf(true);
    setError(null);
    try {
      const columns: WorksheetPdfColumn<Row>[] = [
        ...(visibleColumns.includes("broker") ? [{ label: "Broker", numeric: false, getValue: (r: Row) => r.broker ?? "" }] : []),
        ...(visibleColumns.includes("lotNumber") ? [{ label: "Lot No", numeric: false, getValue: (r: Row) => r.lotNumber ?? "" }] : []),
        ...(visibleColumns.includes("sellingMark")
          ? [{ label: "Selling Mark", numeric: false, getValue: (r: Row) => r.sellingMark ?? "" }]
          : []),
        ...(visibleColumns.includes("grade") ? [{ label: "Grade", numeric: false, getValue: (r: Row) => r.grade ?? "" }] : []),
        ...(visibleColumns.includes("bags") ? [{ label: "Bags", numeric: true, getValue: (r: Row) => (r.bags != null ? String(r.bags) : "") }] : []),
        ...(visibleColumns.includes("netWeight")
          ? [{ label: "Net Weight", numeric: true, getValue: (r: Row) => fmt2(r.netWeight ?? 0) }]
          : []),
        ...(visibleColumns.includes("totalWeight")
          ? [{ label: "Total Weight", numeric: true, getValue: (r: Row) => fmt2(r.totalWeight ?? 0) }]
          : []),
        ...activeExtraKeys.map((key) => ({ label: key, numeric: false, getValue: (r: Row) => r.extra?.[key] ?? "" })),
        { label: "Valuation", numeric: true, getValue: (r: Row) => displayValuation(r) },
        { label: "Total Proceeds", numeric: true, getValue: (r: Row) => fmt2((r.valuation ?? 0) * (r.totalWeight ?? 0)) },
        ...(visibleColumns.includes("remarks") ? [{ label: "Remarks", numeric: false, getValue: (r: Row) => r.remarks ?? "" }] : []),
      ];
      const topic = saleLabel ? `Worksheet — ${saleLabel}` : "Worksheet";
      await exportWorksheetPdf({ topic, columns, rows, excludeUnvalued });
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  const toggleColumn = (key: string) => {
    setVisibleColumns((cols) => (cols.includes(key) ? cols.filter((c) => c !== key) : [...cols, key]));
  };

  const updateValuation = (id: string, text: string) => {
    const clean = sanitizeValuationInput(text);
    setEditingValuation((m) => ({ ...m, [id]: clean }));
    const parsed = parseValuationInput(clean);
    updateRow(id, { valuation: parsed.valuation < 0 ? 0 : parsed.valuation, valuationRangeText: parsed.valuationRangeText });
  };

  const commitValuation = (id: string) => {
    setEditingValuation((m) => {
      if (!(id in m)) return m;
      const next = { ...m };
      delete next[id];
      return next;
    });
  };

  // Fast keyboard entry: Enter in Valuation jumps to that row's Remarks (or straight to the
  // next row's Valuation if the Remarks column is hidden); Enter in Remarks jumps to the next
  // row's Valuation, so a valuer can key straight down the sheet without touching the mouse.
  const focusNextValuation = (rowId: string) => {
    const idx = filteredSortedRows.findIndex((row) => row.id === rowId);
    const next = filteredSortedRows[idx + 1];
    if (next) valuationInputRefs.current.get(next.id)?.focus();
  };
  const focusRemarksOrNextValuation = (rowId: string) => {
    const remarksInput = visibleColumns.includes("remarks") ? remarksInputRefs.current.get(rowId) : undefined;
    if (remarksInput) remarksInput.focus();
    else focusNextValuation(rowId);
  };

  return (
    <div>
      {exportingPdf && <BusyOverlay message="Building PDF…" />}
      {exporting && <BusyOverlay message="Building worksheet…" />}
      <PageHeader
        title="Worksheet"
        subtitle="A rough pre-auction pricing copy. Nothing here saves to sale data — only Valuation Centre does that."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger print:hidden">{error}</div>
      )}
      {notice && (
        <div className="mb-4 p-3.5 rounded border border-border bg-surface-alt text-sm text-text-muted print:hidden">{notice}</div>
      )}

      <div className="grid sm:grid-cols-2 gap-4 mb-5 print:hidden">
        <div className="border border-border rounded-lg bg-surface p-4">
          <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">Import from a sale</h3>
          <div className="flex flex-col gap-2.5">
            <Select
              size="small"
              value={saleCatalogueId}
              onChange={(e) => {
                setSaleCatalogueId(e.target.value);
                setBroker("");
                setFactory([]);
              }}
              displayEmpty
              sx={{ fontSize: 13 }}
              renderValue={(v) => {
                if (!v) return <span className="text-text-muted">Sale number…</span>;
                return catalogues.find((c) => c.id === v)?.sourceName ?? "…";
              }}
            >
              {catalogues.map((c) => (
                <MenuItem key={c.id} value={c.id}>
                  {c.sourceName}
                </MenuItem>
              ))}
            </Select>
            <Autocomplete
              freeSolo
              size="small"
              options={facets?.brokers ?? []}
              inputValue={broker}
              onInputChange={(_, value) => setBroker(value)}
              disabled={!saleCatalogueId}
              renderInput={(params) => <TextField {...params} placeholder="Broker (e.g. ASC)" />}
            />
            <Autocomplete
              multiple
              freeSolo
              disableCloseOnSelect
              size="small"
              options={factoryOptions}
              value={factory}
              onChange={(_, value) => setFactory(value.map((v) => v.split(" — ")[0]))}
              isOptionEqualToValue={(option, value) => option.split(" — ")[0] === value}
              disabled={!saleCatalogueId}
              renderOption={({ key, ...liProps }, option, { selected }) => (
                <li key={key} {...liProps}>
                  <Checkbox size="small" checked={selected} sx={{ p: 0, mr: 1 }} />
                  {option}
                </li>
              )}
              renderInput={(params) => (
                <TextField {...params} placeholder={factory.length ? "" : "MF code(s) or factory name — pick or type, Enter to add"} />
              )}
            />
            <Button variant="outlined" onClick={loadFromSale} disabled={loadingSale || !saleCatalogueId}>
              {loadingSale ? "Loading…" : "Load matching lots"}
            </Button>
          </div>
        </div>

        <div className="border border-border rounded-lg bg-surface p-4">
          <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">Or upload an Excel export</h3>
          <p className="text-[12.5px] text-text-muted mb-3">
            Broker/lot no/selling mark/grade/net &amp; total weight/valuation columns are matched automatically.
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls,.csv"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) uploadFile(f);
            }}
          />
          <Button
            variant="outlined"
            startIcon={<CloudUploadOutlinedIcon fontSize="small" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploading}
          >
            {uploading ? "Uploading…" : "Choose file…"}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4 print:hidden">
        <div className="border border-border rounded-lg bg-surface p-3.5">
          <div className="font-display text-lg font-bold text-text-strong">{formatNumber(rows.length)}</div>
          <div className="text-[11px] text-text-muted">Rows loaded</div>
        </div>
        <div className="border border-border rounded-lg bg-surface p-3.5">
          <div className="font-display text-lg font-bold text-text-strong">{formatNumber(totals.totalQty)}</div>
          <div className="text-[11px] text-text-muted">Total quantity (kg)</div>
        </div>
        <div className="border border-border rounded-lg bg-surface p-3.5">
          <div className="font-display text-lg font-bold text-text-strong">{formatCurrency(totals.totalValue)}</div>
          <div className="text-[11px] text-text-muted">Total value</div>
        </div>
        <div className="border border-border rounded-lg bg-surface p-3.5" style={{ borderColor: "var(--brass)" }}>
          <div className="font-display text-lg font-bold text-text-strong">{formatCurrency(totals.avg)}</div>
          <div className="text-[11px] text-text-muted mb-1">
            {excludeUnvalued
              ? `Average price (valued lots) — ${formatNumber(avgEligibleRows.length)} of ${formatNumber(rows.length)} counted`
              : "Average price — total value ÷ total quantity"}
          </div>
          <FormControlLabel
            control={<Checkbox size="small" checked={excludeUnvalued} onChange={(e) => setExcludeUnvalued(e.target.checked)} />}
            label={<span className="text-[11px]">Entered values only</span>}
            sx={{ m: 0 }}
          />
        </div>
      </div>

      {removedRows.length > 0 && (
        <div className="mb-3 p-3 rounded border border-border bg-surface-alt text-sm text-text-muted flex items-center justify-between gap-3 flex-wrap print:hidden">
          <span>
            {removedRows.length} {removedRows.length === 1 ? "line is" : "lines are"} removed from this worksheet — left out
            of the totals, the average and every export.
          </span>
          <Button size="small" variant="outlined" onClick={restoreAllRemoved}>
            Restore removed lines
          </Button>
        </div>
      )}

      <div className="flex items-center gap-2.5 mb-3 flex-wrap print:hidden">
        <TextField
          size="small"
          placeholder="Search lot no / mark / grade / broker…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          slotProps={{ input: { startAdornment: <SearchIcon fontSize="small" sx={{ mr: 1, color: "var(--text-muted)" }} /> } }}
          sx={{ minWidth: 240 }}
        />
        <Select size="small" value={sortValue} onChange={(e) => setSortValue(e.target.value)} sx={{ fontSize: 13, minWidth: 180 }}>
          {SORT_OPTIONS.map((o) => (
            <MenuItem key={o.value} value={o.value}>
              {o.label}
            </MenuItem>
          ))}
        </Select>
        <Button variant="outlined" startIcon={<ViewColumnOutlinedIcon fontSize="small" />} onClick={(e) => setColumnsAnchor(e.currentTarget)}>
          Columns
        </Button>
        <Menu anchorEl={columnsAnchor} open={!!columnsAnchor} onClose={() => setColumnsAnchor(null)}>
          {ALL_COLUMNS.map((key) => (
            <MenuItem key={key} onClick={() => toggleColumn(key)} dense>
              <Checkbox size="small" checked={visibleColumns.includes(key)} sx={{ p: 0, mr: 1 }} />
              {COLUMN_LABELS[key]}
            </MenuItem>
          ))}
          {extraColumnKeys.length > 0 && <Divider />}
          {extraColumnKeys.map((key) => (
            <MenuItem key={key} onClick={() => toggleColumn(extraColKey(key))} dense>
              <Checkbox size="small" checked={visibleColumns.includes(extraColKey(key))} sx={{ p: 0, mr: 1 }} />
              {key}
            </MenuItem>
          ))}
        </Menu>
        <Button
          variant="text"
          size="small"
          startIcon={<SimCardDownloadOutlinedIcon fontSize="small" />}
          onClick={downloadTemplate}
          disabled={downloadingTemplate}
        >
          {downloadingTemplate ? "Downloading…" : "Download template"}
        </Button>
        <Button variant="outlined" onClick={clearValuations} disabled={rows.length === 0}>
          Clear valuations
        </Button>
        <Button variant="outlined" onClick={resetWorksheet} disabled={rows.length === 0}>
          Reset worksheet
        </Button>
        <div className="flex-1" />
        <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()} disabled={rows.length === 0}>
          Print
        </Button>
        <Button
          variant="outlined"
          startIcon={<PictureAsPdfOutlinedIcon fontSize="small" />}
          onClick={exportPdf}
          disabled={exportingPdf || rows.length === 0}
        >
          {exportingPdf ? "Exporting…" : "Export PDF"}
        </Button>
        <Button
          variant="outlined"
          startIcon={<DownloadOutlinedIcon fontSize="small" />}
          onClick={exportExcel}
          disabled={exporting || rows.length === 0}
        >
          {exporting ? "Exporting…" : "Export to Excel"}
        </Button>
      </div>

      {rows.length === 0 ? (
        <div className="text-center py-16 text-text-muted border border-dashed border-border rounded-lg">
          No rows yet — load lots from a sale or upload an Excel export above.
        </div>
      ) : (
        <div className="report-print-area overflow-x-auto border border-border rounded-lg">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="bg-surface-alt border-b border-border">
                {visibleColumns.includes("broker") && <th className="text-left px-3 py-2 font-medium text-text-muted">Broker</th>}
                {visibleColumns.includes("lotNumber") && <th className="text-left px-3 py-2 font-medium text-text-muted">Lot No</th>}
                {visibleColumns.includes("sellingMark") && <th className="text-left px-3 py-2 font-medium text-text-muted">Selling Mark</th>}
                {visibleColumns.includes("grade") && <th className="text-left px-3 py-2 font-medium text-text-muted">Grade</th>}
                {visibleColumns.includes("bags") && <th className="text-right px-3 py-2 font-medium text-text-muted">Bags</th>}
                {visibleColumns.includes("netWeight") && <th className="text-right px-3 py-2 font-medium text-text-muted">Net Weight</th>}
                {visibleColumns.includes("totalWeight") && <th className="text-right px-3 py-2 font-medium text-text-muted">Total Weight</th>}
                {activeExtraKeys.map((key) => (
                  <th key={key} className="text-left px-3 py-2 font-medium text-text-muted">
                    {key}
                  </th>
                ))}
                <th className="text-right px-3 py-2 font-medium text-text-muted">Valuation</th>
                <th className="text-right px-3 py-2 font-medium text-text-muted">Total Proceeds</th>
                {visibleColumns.includes("remarks") && <th className="text-left px-3 py-2 font-medium text-text-muted">Remarks</th>}
                <th className="px-2 py-2 print:hidden" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {filteredSortedRows.map((r) => {
                const totalProceeds = (r.valuation ?? 0) * (r.totalWeight ?? 0);
                const isNegative = (editingValuation[r.id] !== undefined ? parseValuationInput(editingValuation[r.id]).valuation : (r.valuation ?? 0)) < 0;
                return (
                  <tr key={r.id} className="border-b border-border last:border-0">
                    {visibleColumns.includes("broker") && <td className="px-3 py-1.5">{r.broker ?? "—"}</td>}
                    {visibleColumns.includes("lotNumber") && <td className="px-3 py-1.5">{r.lotNumber ?? "—"}</td>}
                    {visibleColumns.includes("sellingMark") && <td className="px-3 py-1.5">{r.sellingMark ?? "—"}</td>}
                    {visibleColumns.includes("grade") && <td className="px-3 py-1.5">{r.grade ?? "—"}</td>}
                    {visibleColumns.includes("bags") && (
                      <td className="px-3 py-1.5 text-right font-mono">{r.bags != null ? r.bags : "—"}</td>
                    )}
                    {visibleColumns.includes("netWeight") && (
                      <td className="px-3 py-1.5 text-right font-mono">{r.netWeight != null ? formatNumber(r.netWeight) : "—"}</td>
                    )}
                    {visibleColumns.includes("totalWeight") && (
                      <td className="px-3 py-1.5 text-right font-mono">{r.totalWeight != null ? formatNumber(r.totalWeight) : "—"}</td>
                    )}
                    {activeExtraKeys.map((key) => (
                      <td key={key} className="px-3 py-1.5">
                        {r.extra?.[key] ?? "—"}
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right">
                      <TextField
                        size="small"
                        placeholder="0.00 or 1100-1150"
                        error={isNegative}
                        // An untouched, unvalued row shows blank rather than "0.00" — 0.00 read
                        // as an already-entered value and forced a backspace-everything before
                        // typing a real one.
                        value={editingValuation[r.id] ?? (r.valuationRangeText || (r.valuation ? fmt2(r.valuation) : ""))}
                        onChange={(e) => updateValuation(r.id, e.target.value)}
                        onBlur={() => commitValuation(r.id)}
                        onFocus={(e) => e.target.select()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            focusRemarksOrNextValuation(r.id);
                          }
                        }}
                        inputRef={(el: HTMLInputElement | null) => {
                          if (el) valuationInputRefs.current.set(r.id, el);
                          else valuationInputRefs.current.delete(r.id);
                        }}
                        // Wide enough to show a full range ("1,200.00 - 1,300.00") without
                        // clipping — a plain single value just leaves the extra space unused.
                        sx={{ width: r.valuationRangeText || editingValuation[r.id]?.includes("-") ? 190 : 120 }}
                        slotProps={{ htmlInput: { style: { textAlign: "right" }, inputMode: "decimal" } }}
                        className="print:hidden"
                      />
                      <span className="hidden print:inline font-mono">{displayValuation(r) || "—"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(totalProceeds)}</td>
                    {visibleColumns.includes("remarks") && (
                      <td className="px-2 py-1">
                        <TextField
                          size="small"
                          value={r.remarks ?? ""}
                          onChange={(e) => updateRow(r.id, { remarks: e.target.value })}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              focusNextValuation(r.id);
                            }
                          }}
                          inputRef={(el: HTMLInputElement | null) => {
                            if (el) remarksInputRefs.current.set(r.id, el);
                            else remarksInputRefs.current.delete(r.id);
                          }}
                          sx={{ minWidth: 140 }}
                          className="print:hidden"
                        />
                        <span className="hidden print:inline">{r.remarks ?? ""}</span>
                      </td>
                    )}
                    <td className="px-2 print:hidden">
                      <Button size="small" color="error" onClick={() => removeRow(r.id)} aria-label="Remove row" sx={{ minWidth: 0, p: 0.5 }}>
                        <DeleteOutlineIcon fontSize="small" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <Snackbar
        open={!!undoRow}
        autoHideDuration={8000}
        onClose={() => setUndoRow(null)}
        message={undoRow ? `${undoRow.lotNumber ? `Lot ${undoRow.lotNumber}` : "Line"} removed — totals recalculated.` : ""}
        action={
          <Button
            color="inherit"
            size="small"
            onClick={() => {
              if (undoRow) restoreRow(undoRow.id);
              setUndoRow(null);
            }}
          >
            Undo
          </Button>
        }
        anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      />
    </div>
  );
}
