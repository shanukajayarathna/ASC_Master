"use client";

import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { WorksheetFacets, WorksheetRow } from "@/types/api";
import {
  dateStamp,
  displayValuationForExport as displayPrice,
  exportWorksheetPdf,
  fmt2,
  safeFileName,
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
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Snackbar from "@mui/material/Snackbar";
import TextField from "@mui/material/TextField";
import { useEffect, useMemo, useRef, useState } from "react";

interface Row extends WorksheetRow {
  id: string;
}

interface ReportMeta {
  reportName: string;
  saleNumber: string;
  markName: string;
}

// "Broker Lot No" (not "Lot No") — matches the original standalone Asking Price tool's
// DEFAULT_COLUMNS label exactly; everything else lines up with the Worksheet tool's columns.
type ColumnKey = "broker" | "lotNumber" | "sellingMark" | "grade" | "bags" | "netWeight" | "totalWeight" | "remarks";

const COLUMN_LABELS: Record<ColumnKey, string> = {
  broker: "Broker",
  lotNumber: "Broker Lot No",
  sellingMark: "Selling Mark",
  grade: "Grade",
  bags: "Bags",
  netWeight: "Net Weight",
  totalWeight: "Total Weight",
  remarks: "Remarks",
};

const ALL_COLUMNS = Object.keys(COLUMN_LABELS) as ColumnKey[];
const SESSION_KEY = "asc_askingPrice_session_v1";
const PRICE_RANGE_RE = /^(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)$/;
const AUTO_SHOW_EXTRA_PATTERNS = [/invoice/i, /\binv\b/i];
const EXTRA_PREFIX = "extra:";
const extraColKey = (rawKey: string) => `${EXTRA_PREFIX}${rawKey}`;
const EMPTY_META: ReportMeta = { reportName: "", saleNumber: "", markName: "" };

const SORT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Default order" },
  { value: "grade-asc", label: "Grade (A–Z)" },
  { value: "grade-desc", label: "Grade (Z–A)" },
  { value: "totalWeight-desc", label: "Weight (High–Low)" },
  { value: "totalWeight-asc", label: "Weight (Low–High)" },
  { value: "askingPrice-desc", label: "Asking Price (High–Low)" },
  { value: "askingPrice-asc", label: "Asking Price (Low–High)" },
  { value: "totalValue-desc", label: "Total Value (High–Low)" },
  { value: "totalValue-asc", label: "Total Value (Low–High)" },
];

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `r_${Date.now()}_${Math.random()}`;
}

function toRow(w: WorksheetRow): Row {
  return { ...w, id: newId() };
}

/** Identifies "the same lot" regardless of which load produced it — same dedupe rule as the
 *  Worksheet tool, so re-loading/re-uploading never leaves a visually duplicated row behind. */
function rowSignature(w: WorksheetRow): string {
  return [w.lotNumber, w.broker, w.sellingMark, w.grade, w.netWeight, w.totalWeight]
    .map((v) => (v ?? "").toString().trim().toLowerCase())
    .join("|");
}

function mergeUniqueRows(existing: Row[], incoming: WorksheetRow[]): { rows: Row[]; duplicates: number } {
  const seen = new Set(existing.map(rowSignature));
  const additions: Row[] = [];
  let duplicates = 0;
  for (const w of incoming) {
    const sig = rowSignature(w);
    if (seen.has(sig)) {
      duplicates += 1;
      continue;
    }
    seen.add(sig);
    additions.push(toRow(w));
  }
  return { rows: [...existing, ...additions], duplicates };
}

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

interface StoredSession {
  rows: Row[];
  visibleColumns: string[];
  reportMeta: ReportMeta;
}

function loadSession(): StoredSession {
  if (typeof window === "undefined") return { rows: [], visibleColumns: ALL_COLUMNS, reportMeta: EMPTY_META };
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return { rows: [], visibleColumns: ALL_COLUMNS, reportMeta: EMPTY_META };
    const saved = JSON.parse(raw) as { rows?: Row[]; visibleColumns?: string[]; reportMeta?: ReportMeta };
    return {
      rows: Array.isArray(saved.rows) ? dedupeStoredRows(saved.rows) : [],
      visibleColumns: Array.isArray(saved.visibleColumns) ? saved.visibleColumns : ALL_COLUMNS,
      reportMeta: saved.reportMeta ?? EMPTY_META,
    };
  } catch {
    return { rows: [], visibleColumns: ALL_COLUMNS, reportMeta: EMPTY_META };
  }
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Ported exactly from the original standalone Asking Price tool's parsePriceInput: a range
 *  like "1100-1150" keeps its full text for display, but the LOWER value — never the midpoint —
 *  is what feeds Total Value/every total/the average/sorting. */
function parsePriceInput(text: string): { valuation: number; valuationRangeText: string | null } {
  const raw = text.trim();
  if (!raw) return { valuation: 0, valuationRangeText: null };
  const rangeMatch = raw.match(PRICE_RANGE_RE);
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

/** No letters allowed in the Asking Price box — only digits, a decimal point and "-" survive. */
function sanitizePriceInput(text: string): string {
  return text.replace(/[^0-9.-]/g, "");
}

/** Ported from the original's getAutoMarkName: a single selling mark across every loaded row
 *  fills the Mark field automatically; more than one joins them with " + "; none leaves it blank. */
function getAutoMarkName(list: Row[]): string {
  const marks = Array.from(new Set(list.map((r) => r.sellingMark).filter((v): v is string => Boolean(v))));
  if (marks.length === 1) return marks[0];
  if (marks.length > 1) return marks.join(" + ");
  return "";
}

/** Ported from the original's buildReportTopic: the custom report name (if entered) replaces
 *  only the leading title; Sale No and Mark are appended when present. */
function buildReportTopic(meta: ReportMeta): string {
  const base = meta.reportName.trim() || "Tea Asking Price Report";
  const parts = [base];
  if (meta.saleNumber.trim()) parts.push(`Sale ${meta.saleNumber.trim()}`);
  if (meta.markName.trim()) parts.push(meta.markName.trim());
  return parts.join(" - ");
}

function sortValueOf(r: Row, key: string): number | string {
  switch (key) {
    case "grade":
      return r.grade ?? "";
    case "totalWeight":
      return r.totalWeight ?? 0;
    case "askingPrice":
      return r.valuation ?? 0;
    case "totalValue":
      return (r.valuation ?? 0) * (r.totalWeight ?? 0);
    default:
      return "";
  }
}

export default function AskingPricePage() {
  const { catalogues } = useCatalogue();

  const session = useMemo(() => loadSession(), []);
  const [rows, setRows] = useState<Row[]>(() => session.rows);
  const [visibleColumns, setVisibleColumns] = useState<string[]>(() => session.visibleColumns);
  const [reportMeta, setReportMeta] = useState<ReportMeta>(() => session.reportMeta);
  const [search, setSearch] = useState("");
  const [sortValue, setSortValue] = useState("");
  const [editingValuation, setEditingValuation] = useState<Record<string, string>>({});

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
  const saleNumberRef = useRef<HTMLInputElement>(null);
  const valuationInputRefs = useRef(new Map<string, HTMLInputElement>());
  const remarksInputRefs = useRef(new Map<string, HTMLInputElement>());

  // Persist the working table to this browser on every change — nothing here ever touches the
  // backend, matching the original standalone tool's client-only session persistence. Kept in
  // its own session key so Worksheet and Asking Price never share or overwrite each other's data.
  useEffect(() => {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ rows, visibleColumns, reportMeta }));
    } catch {
      // storage full/unavailable — session just won't survive a refresh
    }
  }, [rows, visibleColumns, reportMeta]);

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

  const extraColumnKeys = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows) {
      if (!r.extra) continue;
      for (const key of Object.keys(r.extra)) if (!seen.includes(key)) seen.push(key);
    }
    return seen;
  }, [rows]);

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
      let duplicates = 0;
      let merged: Row[] = rows;
      setRows((r) => {
        const m = mergeUniqueRows(r, result.rows);
        duplicates = m.duplicates;
        merged = m.rows;
        return m.rows;
      });
      setReportMeta((m) => ({ ...m, markName: getAutoMarkName(merged) }));
      const dupSuffix = duplicates ? ` (${duplicates} already in the table, skipped)` : "";
      setNotice(
        result.truncated
          ? `Loaded the first ${result.rows.length} of ${result.totalMatches} matching lots — narrow the filters to see the rest.${dupSuffix}`
          : `Loaded ${result.rows.length} lot(s).${dupSuffix}`
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
      let duplicates = 0;
      let merged: Row[] = rows;
      setRows((r) => {
        const m = mergeUniqueRows(r, result.rows);
        duplicates = m.duplicates;
        merged = m.rows;
        return m.rows;
      });
      setReportMeta((m) => ({ ...m, markName: getAutoMarkName(merged) }));
      const dupSuffix = duplicates ? `, ${duplicates} already in the table skipped` : "";
      setNotice(
        result.skippedRows
          ? `Loaded ${result.rows.length} row(s) from "${result.fileName}" (${result.skippedRows} incomplete row(s) skipped${dupSuffix}).`
          : `Loaded ${result.rows.length} row(s) from "${result.fileName}"${dupSuffix ? ` (${duplicates} already in the table skipped)` : ""}.`
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

  const clearAskingPrices = () => {
    if (!rows.length) return;
    if (!window.confirm("Clear all entered asking prices? This cannot be undone.")) return;
    setRows((r) => r.map((row) => ({ ...row, valuation: 0, valuationRangeText: null })));
    setEditingValuation({});
    setNotice("All asking prices cleared.");
  };

  const resetWorksheet = () => {
    if (!rows.length) return;
    if (!window.confirm("Reset the current worksheet to the default state? This will clear the loaded data and any entered asking prices.")) return;
    setRows([]);
    setRemovedRows([]);
    setUndoRow(null);
    setVisibleColumns(ALL_COLUMNS);
    setSearch("");
    setSortValue("");
    setReportMeta(EMPTY_META);
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
      const blob = await api.downloadWorksheetTemplate("Asking Price");
      triggerDownload(blob, "tea-asking-price-template.xlsx");
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

  const totals = useMemo(() => {
    const totalQty = rows.reduce((sum, r) => sum + (r.totalWeight ?? 0), 0);
    const totalValue = rows.reduce((sum, r) => sum + (r.valuation ?? 0) * (r.totalWeight ?? 0), 0);
    return { totalQty, totalValue, avg: totalQty > 0 ? totalValue / totalQty : 0 };
  }, [rows]);

  const activeExtraKeys = useMemo(
    () => extraColumnKeys.filter((key) => visibleColumns.includes(extraColKey(key))),
    [extraColumnKeys, visibleColumns]
  );

  const requireSaleNumber = (): boolean => {
    if (reportMeta.saleNumber.trim()) return true;
    setError("Sale number is required before exporting.");
    saleNumberRef.current?.focus();
    return false;
  };

  const exportExcel = async () => {
    if (!requireSaleNumber()) return;
    setExporting(true);
    setError(null);
    try {
      const topic = buildReportTopic(reportMeta);
      const blob = await api.exportWorksheetExcel(
        topic,
        null,
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
        false,
        activeExtraKeys,
        { valuationLabel: "Asking Price", proceedsLabel: "Total Value", sheetName: "Asking Price Report" }
      );
      triggerDownload(blob, `${safeFileName(topic)}-${dateStamp()}.xlsx`);
      setNotice("Excel report exported.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const [exportingPdf, setExportingPdf] = useState(false);
  const exportPdf = async () => {
    if (!requireSaleNumber()) return;
    setExportingPdf(true);
    setError(null);
    try {
      const columns: WorksheetPdfColumn<Row>[] = [
        ...(visibleColumns.includes("broker") ? [{ label: "Broker", numeric: false, getValue: (r: Row) => r.broker ?? "" }] : []),
        ...(visibleColumns.includes("lotNumber")
          ? [{ label: "Broker Lot No", numeric: false, getValue: (r: Row) => r.lotNumber ?? "" }]
          : []),
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
        { label: "Asking Price", numeric: true, getValue: (r: Row) => displayPrice(r) },
        { label: "Total Value", numeric: true, getValue: (r: Row) => fmt2((r.valuation ?? 0) * (r.totalWeight ?? 0)) },
        ...(visibleColumns.includes("remarks") ? [{ label: "Remarks", numeric: false, getValue: (r: Row) => r.remarks ?? "" }] : []),
      ];
      const topic = buildReportTopic(reportMeta);
      await exportWorksheetPdf({ topic, columns, rows, excludeUnvalued: false });
      setNotice("PDF report exported.");
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
    const clean = sanitizePriceInput(text);
    setEditingValuation((m) => ({ ...m, [id]: clean }));
    const parsed = parsePriceInput(clean);
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
      <PageHeader
        title="Asking Price"
        subtitle="The same fast worksheet, for pre-auction asking prices. Nothing here saves to sale data — its own session, kept separate from Worksheet."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark print:hidden">{error}</div>
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
            Broker/lot no/selling mark/grade/net &amp; total weight/asking price columns are matched automatically — one or
            more workbooks can be combined.
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
          <div className="flex gap-2 flex-wrap">
            <Button
              variant="outlined"
              startIcon={<CloudUploadOutlinedIcon fontSize="small" />}
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? "Uploading…" : "Choose file…"}
            </Button>
            <Button
              variant="text"
              size="small"
              startIcon={<SimCardDownloadOutlinedIcon fontSize="small" />}
              onClick={downloadTemplate}
              disabled={downloadingTemplate}
            >
              {downloadingTemplate ? "Downloading…" : "Download template"}
            </Button>
          </div>
        </div>
      </div>

      <div className="grid sm:grid-cols-3 gap-3 mb-5 print:hidden">
        <TextField
          size="small"
          label="Report name"
          placeholder="Tea Asking Price Report"
          value={reportMeta.reportName}
          onChange={(e) => setReportMeta((m) => ({ ...m, reportName: e.target.value }))}
        />
        <TextField
          size="small"
          label="Sale No"
          placeholder="e.g. 28"
          value={reportMeta.saleNumber}
          onChange={(e) => setReportMeta((m) => ({ ...m, saleNumber: e.target.value }))}
          inputRef={saleNumberRef}
          required
        />
        <TextField
          size="small"
          label="Mark"
          placeholder="Selling mark"
          value={reportMeta.markName}
          onChange={(e) => setReportMeta((m) => ({ ...m, markName: e.target.value }))}
        />
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
          <div className="text-[11px] text-text-muted">Average price — total value ÷ total quantity</div>
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
        <Button variant="outlined" onClick={clearAskingPrices} disabled={rows.length === 0}>
          Clear asking prices
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
                {visibleColumns.includes("lotNumber") && (
                  <th className="text-left px-3 py-2 font-medium text-text-muted">Broker Lot No</th>
                )}
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
                <th className="text-right px-3 py-2 font-medium text-text-muted">Asking Price</th>
                <th className="text-right px-3 py-2 font-medium text-text-muted">Total Value</th>
                {visibleColumns.includes("remarks") && <th className="text-left px-3 py-2 font-medium text-text-muted">Remarks</th>}
                <th className="px-2 py-2 print:hidden" aria-label="Remove" />
              </tr>
            </thead>
            <tbody>
              {filteredSortedRows.map((r) => {
                const totalValue = (r.valuation ?? 0) * (r.totalWeight ?? 0);
                const isNegative = (editingValuation[r.id] !== undefined ? parsePriceInput(editingValuation[r.id]).valuation : (r.valuation ?? 0)) < 0;
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
                        value={editingValuation[r.id] ?? displayPrice(r)}
                        onChange={(e) => updateValuation(r.id, e.target.value)}
                        onBlur={() => commitValuation(r.id)}
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
                        sx={{ width: 120 }}
                        slotProps={{ htmlInput: { style: { textAlign: "right" }, inputMode: "decimal" } }}
                        className="print:hidden"
                      />
                      <span className="hidden print:inline font-mono">{displayPrice(r) || "—"}</span>
                    </td>
                    <td className="px-3 py-1.5 text-right font-mono">{formatCurrency(totalValue)}</td>
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
