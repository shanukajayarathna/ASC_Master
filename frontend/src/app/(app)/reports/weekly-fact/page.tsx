"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import PageHeader from "@/components/shared/PageHeader";
import { api, ApiError } from "@/lib/api";
import { dateStamp } from "@/lib/worksheetPdf";
import {
  buildMarketShareComparePdf,
  buildMarketSharePdf,
  type MarketShareCompareTablePdfData,
  type MarketShareTablePdfData,
} from "@/lib/weeklyFactPdf";
import {
  buildMarketShareCompareRows,
  buildMarketShareWorkbook,
  computeDefaultLowHeaderText,
  computeDefaultRankHeaderText,
  parseCatalogueTotals,
  runJob,
  wesReportFromDatabase,
  type MarketShareCompareRow,
  type WeeklyJobResult,
  type WesInput,
  type WesReport,
} from "@/lib/weeklyFactReport";

/** The four MARKET SHARE tables, in the workbook's own order — shared between the ZIP builder
 *  and the per-card PDF button so the two never drift apart. */
const MARKET_SHARE_TABLE_SPECS: { field: string; title: string }[] = [
  { field: "totalQty", title: "MARKET SHARE (TOTAL FRESH TEAS)" },
  { field: "exEstateQty", title: "MARKET SHARE (EX-ESTATE)" },
  { field: "hmQty", title: "MARKET SHARE (HIGH & MEDIUM FRESH TEAS)" },
  { field: "lowQty", title: "MARKET SHARE (LOW FRESH TEAS)" },
];

/** The MARKET SHARE workbook's own result shape, decoupled from WeeklyJobResult so it can be
 *  produced two ways: standalone (just the catalogued-totals file, nothing else needed) or as
 *  part of a full "Generate reports" run (the two paths write into this same state — see
 *  generateMarketShareOnly / generate). */
interface MarketShareResult {
  filename: string;
  buffer: ArrayBuffer;
  rowsByTable: Record<string, { code: string; qty: number }[]>;
  warnings: string[];
  ok: boolean;
  saleNumber: number | null;
  // Set only when a "last week" catalogued-totals file was also supplied — same four tables,
  // each row carrying last week's qty and the +/- diff too. Non-null here is what switches the
  // downloaded PDF (and the ZIP's copy of it) from the plain layout to the compare layout.
  compareRowsByTable: Record<string, MarketShareCompareRow[]> | null;
  previousSaleNumber: number | null;
}

function marketShareTablesOf(rowsByTable: MarketShareResult["rowsByTable"]): MarketShareTablePdfData[] {
  return MARKET_SHARE_TABLE_SPECS.map((spec) => ({
    title: spec.title,
    rows: rowsByTable[spec.field] ?? [],
  }));
}

function marketShareCompareTablesOf(compareRowsByTable: Record<string, MarketShareCompareRow[]>): MarketShareCompareTablePdfData[] {
  return MARKET_SHARE_TABLE_SPECS.map((spec) => ({
    title: spec.title,
    rows: compareRowsByTable[spec.field] ?? [],
  }));
}

/** Mirrors buildMarketShareWorkbook's own "SN{sale}3026MARKET SHRE.xlsx" filename pattern —
 *  matches the real archived compare PDF's filename exactly (SN353026MARKET SHRE COMPARE
 *  REPORTS.pdf for sale 35). */
function marketShareComparePdfName(saleNumber: number | null): string {
  const saleLabel = saleNumber != null ? String(saleNumber) : "X";
  return `SN${saleLabel}3026MARKET SHRE COMPARE REPORTS.pdf`;
}
import type { SaleSummary } from "@/types/api";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

/** Either the uploaded WES workbook, or the database-computed equivalent for a sale picked
 *  via the "generate from database" panel — see MslWeeklyReportService's own doc comment for
 *  what's verified about that path (568/571 week-level factory rows exact, ~93% on
 *  year-to-date; the CBAC benchmark TXT stays upload-only, unaffected by this). */
type WesSource =
  | { kind: "upload"; fileName: string; arrayBuffer: ArrayBuffer }
  | { kind: "database"; saleYear: number; saleNo: number; saleDate: string; report: WesReport; categoryCounts: [string, number][] };

const pdfNameOf = (xlsxName: string) => xlsxName.replace(/\.xlsx$/i, ".pdf");

interface FileState {
  fileName: string;
}

function fmtAvg(v: number | null): string {
  return v == null ? "—" : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function triggerDownload(buffer: ArrayBuffer | Blob, name: string, type: string) {
  const blob = buffer instanceof Blob ? buffer : new Blob([buffer], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** A drop target that also opens the file picker on click — same two ways in as the original's
 *  dropzones (drag & drop, or click to browse), styled with this app's own components instead
 *  of the legacy CSS. */
function Dropzone({
  label,
  hint,
  accept,
  file,
  onFile,
}: {
  label: string;
  hint: string;
  accept: string;
  file: FileState | null;
  onFile: (f: File) => void;
}) {
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="border border-border rounded-lg bg-surface p-4">
      {label && <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">{label}</h3>}
      <div
        role="button"
        tabIndex={0}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
        }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) onFile(f);
        }}
        className="cursor-pointer text-center py-6 rounded-lg border-2 border-dashed transition-colors"
        style={{
          borderColor: dragOver ? "var(--liquor)" : "var(--border)",
          background: dragOver ? "var(--surface-alt)" : "transparent",
        }}
      >
        <CloudUploadOutlinedIcon sx={{ fontSize: 28, color: "var(--text-muted)" }} />
        <div className="text-[13px] font-semibold text-text-strong mt-1">Drag &amp; drop, or click to browse</div>
        <div className="text-[12px] text-text-muted mt-0.5">{hint}</div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFile(f);
            e.target.value = "";
          }}
        />
      </div>
      <div className="mt-2 text-[12.5px] flex items-center gap-1.5" style={{ color: file ? "var(--sage)" : "var(--text-muted)" }}>
        {file && <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />}
        {file ? file.fileName : "No file loaded yet."}
      </div>
    </div>
  );
}

function Warnings({ warnings, tone }: { warnings: string[]; tone: "warning" | "danger" }) {
  if (!warnings.length) return null;
  return (
    <div
      className="mt-2.5 p-2.5 rounded border text-[12px] leading-relaxed"
      style={{
        borderColor: tone === "danger" ? "var(--danger)" : "var(--brass)",
        background: tone === "danger" ? "var(--danger-light)" : "var(--surface-alt)",
        color: tone === "danger" ? "var(--liquor-dark)" : "var(--text-muted)",
      }}
    >
      <p className="font-semibold m-0 mb-1">{warnings.length === 1 ? "1 warning" : `${warnings.length} warnings`}</p>
      {warnings.map((w, i) => (
        <p key={i} className="m-0">
          {w}
        </p>
      ))}
    </div>
  );
}

/** One row's-worth of "loaded" confirmation, styled to match the Dropzone's own bottom line
 *  — used for the database-load path, which has no file to drop but needs the same at-a-
 *  -glance "is something ready?" signal. */
function LoadedLine({ ready, text }: { ready: boolean; text: string }) {
  return (
    <div className="mt-2 text-[12.5px] flex items-center gap-1.5" style={{ color: ready ? "var(--sage)" : "var(--text-muted)" }}>
      {ready && <CheckCircleOutlineIcon sx={{ fontSize: 15 }} />}
      {text}
    </div>
  );
}

/** The shared skeleton every generated-workbook card uses: an eyebrow label, a big count,
 *  a one-line caption under it, free-form description content, a download + a PDF button,
 *  and any warnings — kept in one place so the FACT/RANK/LOW cards can't visually drift from
 *  each other despite having slightly different data shapes underneath. */
function ResultCard({
  eyebrow,
  count,
  countLabel,
  ok,
  description,
  hasBuffer,
  downloadLabel,
  onDownload,
  pdfName,
  pdfLabel,
  pdfBusy,
  onPdf,
  // A second, independent PDF output for the same card (currently only MARKET SHARE uses
  // this: the compare PDF sits alongside the plain one, not instead of it) — same busy/disabled
  // wiring as the primary PDF button, just a second button underneath it.
  secondaryPdf,
  warnings,
}: {
  eyebrow: string;
  count: number;
  countLabel: string;
  ok: boolean;
  description: ReactNode;
  hasBuffer: boolean;
  downloadLabel: string;
  onDownload: () => void;
  pdfName: string | null;
  pdfLabel: string;
  pdfBusy: string | null;
  onPdf: () => void;
  secondaryPdf?: { name: string; label: string; onPdf: () => void } | null;
  warnings: string[];
}) {
  const pdfIsBusy = pdfName !== null && pdfBusy === pdfName;
  const secondaryPdfIsBusy = !!secondaryPdf && pdfBusy === secondaryPdf.name;
  return (
    <div className="border rounded-lg bg-surface p-4" style={{ borderColor: ok ? "var(--brass)" : "var(--border)" }}>
      <div className="text-[11px] font-medium text-text-muted">{eyebrow}</div>
      <div className="font-display text-2xl font-bold text-text-strong">{count}</div>
      <div className="text-[11px] text-text-muted mb-2.5">{countLabel}</div>
      <div className="text-[12.5px] leading-relaxed text-text-strong">{description}</div>
      <Button
        fullWidth
        variant="outlined"
        size="small"
        startIcon={<DownloadOutlinedIcon fontSize="small" />}
        sx={{ mt: 1.75, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
        disabled={!hasBuffer}
        onClick={onDownload}
      >
        {hasBuffer ? downloadLabel : "Not generated"}
      </Button>
      <Button
        fullWidth
        variant="outlined"
        size="small"
        startIcon={pdfIsBusy ? <CircularProgress size={14} /> : <PictureAsPdfOutlinedIcon fontSize="small" />}
        sx={{ mt: 1, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
        disabled={!hasBuffer || pdfBusy !== null}
        aria-busy={pdfIsBusy}
        onClick={onPdf}
      >
        {pdfIsBusy ? "Building PDF…" : pdfLabel}
      </Button>
      {secondaryPdf && (
        <Button
          fullWidth
          variant="outlined"
          size="small"
          startIcon={secondaryPdfIsBusy ? <CircularProgress size={14} /> : <PictureAsPdfOutlinedIcon fontSize="small" />}
          sx={{ mt: 1, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
          disabled={!hasBuffer || pdfBusy !== null}
          aria-busy={secondaryPdfIsBusy}
          onClick={secondaryPdf.onPdf}
        >
          {secondaryPdfIsBusy ? "Building PDF…" : secondaryPdf.label}
        </Button>
      )}
      <Warnings warnings={warnings} tone={ok ? "warning" : "danger"} />
    </div>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return <div className="text-[11px] font-semibold tracking-wide uppercase text-text-muted mb-2">{children}</div>;
}

export default function WeeklyFactReportsPage() {
  const [txtData, setTxtData] = useState<{ fileName: string; text: string } | null>(null);
  const [wesSource, setWesSource] = useState<WesSource | null>(null);
  // Optional third source: the "ALL BROKERS CATALOGUED TOTALS" workbook, which drives the
  // MARKET SHARE workbook alone — every other output works with just the TXT + WES pair, so
  // this is never required for "Generate reports" to be enabled.
  const [catalogueTotalsData, setCatalogueTotalsData] = useState<{ fileName: string; arrayBuffer: ArrayBuffer } | null>(null);
  // Optional fourth source: the immediately-preceding sale's own catalogued-totals workbook —
  // drives the MARKET SHARE compare columns (THIS WEEK/LAST WEEK/+/-) alone. Never required;
  // when absent the MARKET SHARE output stays the plain layout.
  const [previousCatalogueTotalsData, setPreviousCatalogueTotalsData] = useState<{ fileName: string; arrayBuffer: ArrayBuffer } | null>(null);
  // The MARKET SHARE workbook's own result — set either by the standalone "Generate Market
  // Share" button (just the one file, nothing else needed) or, after a full "Generate reports"
  // run that included the catalogued-totals file, synced from that job's own result. Either way
  // the card below reads from here, so there's only ever one Market Share result on screen.
  const [marketShareResult, setMarketShareResult] = useState<MarketShareResult | null>(null);
  const [generatingMarketShare, setGeneratingMarketShare] = useState(false);
  const [saleDate, setSaleDate] = useState("");
  const [saleNumberOverride, setSaleNumberOverride] = useState("");
  // Auto-filled once the TXT is read (see handleTxtFile), but always left editable — the real
  // RANK archives show this date-range text typed by hand each week with its own inconsistent
  // spacing/abbreviation, so no formula can promise a byte-perfect match; this field is how a
  // computed best guess gets corrected to match exactly when it needs to.
  const [rankHeaderText, setRankHeaderText] = useState("");
  // Same deal for the LOW RANK/MARK WISE workbooks' own C4 header (a different hand-typed
  // format: " Sale No. 31 - 11th  / 12th  AUGUST 2026").
  const [lowHeaderText, setLowHeaderText] = useState("");

  const [generating, setGenerating] = useState(false);
  const [zipping, setZipping] = useState(false);
  // Filename of the PDF currently being built — locks that card's PDF button (logo load +
  // rendering take a moment, and a double-click would build the same file twice).
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const [job, setJob] = useState<WeeklyJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  // "Generate from database" — an alternative to uploading the WES file, for a sale that's
  // already been imported into the MSL archive; upload stays the fallback for anything not
  // in there yet. Sale list is fetched once on mount (rollup-backed, cheap) so the year/sale
  // pickers can default to the latest sale straight away.
  const [dbSales, setDbSales] = useState<SaleSummary[] | null>(null);
  const [dbSalesError, setDbSalesError] = useState(false);
  const [dbYear, setDbYear] = useState<number | "">("");
  const [dbSaleNo, setDbSaleNo] = useState<number | "">("");
  const [dbLoading, setDbLoading] = useState(false);
  // Which WES input method is showing — purely a UI toggle; wesSource (whichever one actually
  // succeeded) is what generate() reads from, so switching tabs to look around never loses it.
  const [wesMode, setWesMode] = useState<"upload" | "database">("upload");
  const [advancedOpen, setAdvancedOpen] = useState(false);

  useEffect(() => {
    api
      .mslAnalyticsSales()
      .then((sales) => {
        const real = sales.filter((s) => s.saleNo > 0); // saleNo 0 = a year's private-sale bucket
        setDbSales(real);
        if (real.length > 0) {
          setDbYear(real[0].year);
          setDbSaleNo(real[0].saleNo);
        }
      })
      .catch(() => setDbSalesError(true));
  }, []);

  const dbYears = useMemo(() => Array.from(new Set((dbSales ?? []).map((s) => s.year))).sort((a, b) => b - a), [dbSales]);
  const dbSalesForYear = useMemo(
    () => (dbSales ?? []).filter((s) => s.year === dbYear).sort((a, b) => b.saleNo - a.saleNo),
    [dbSales, dbYear]
  );

  const loadWesFromDatabase = async () => {
    if (dbYear === "" || dbSaleNo === "" || dbLoading) return;
    setDbLoading(true);
    setError(null);
    try {
      const dto = await api.mslWeeklyReportWes(dbYear, dbSaleNo);
      const report = wesReportFromDatabase(dto);
      const categoryCounts = Object.entries(report.categories).map(([k, v]) => [k, v.length] as [string, number]);
      setWesSource({ kind: "database", saleYear: dbYear, saleNo: dto.saleNo, saleDate: dto.saleDate, report, categoryCounts });
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) {
        setError(`Sale ${dbSaleNo} of ${dbYear} isn't in the database yet — upload the WES file for this sale instead.`);
      } else {
        setError(e instanceof Error ? `Failed to load from the database: ${e.message}` : "Failed to load from the database.");
      }
    } finally {
      setDbLoading(false);
    }
  };

  const handleTxtFile = async (file: File) => {
    if (!/\.txt$/i.test(file.name)) {
      setError("Please upload a .txt file (the CBAC weekly elevation average report).");
      return;
    }
    setError(null);
    const text = await file.text();
    setTxtData({ fileName: file.name, text });
    // Fill sale date/number/RANK header from THIS file every time — a fresh upload always wins
    // over whatever was there before, so switching to a different week's TXT doesn't leave the
    // previous week's auto-filled values stuck on screen (previously these only filled blank
    // fields, which meant a second upload left the first file's values in place until a page
    // refresh). Only skip a field when the new file itself doesn't yield a value, so a bad parse
    // doesn't wipe out a value the user is actively relying on.
    try {
      const { parseTxt } = await import("@/lib/weeklyFactReport");
      const parsed = parseTxt(text);
      if (parsed.saleDate) setSaleDate(parsed.saleDate);
      if (parsed.saleNumber != null) setSaleNumberOverride(String(parsed.saleNumber));
      const computed = computeDefaultRankHeaderText(parsed.saleDate, parsed.saleNumber);
      if (computed) setRankHeaderText(computed);
      const computedLow = computeDefaultLowHeaderText(parsed.saleDate, parsed.saleNumber);
      if (computedLow) setLowHeaderText(computedLow);
    } catch {
      // leave fields as they are; Generate will surface the real parse error
    }
  };

  const handleWesFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Please upload a .xlsx file (the WES master factory-wise sale file).");
      return;
    }
    setError(null);
    const arrayBuffer = await file.arrayBuffer();
    setWesSource({ kind: "upload", fileName: file.name, arrayBuffer });
  };

  const handleCatalogueTotalsFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Please upload a .xlsx file (the ALL BROKERS CATALOGUED TOTALS workbook).");
      return;
    }
    setError(null);
    const arrayBuffer = await file.arrayBuffer();
    setCatalogueTotalsData({ fileName: file.name, arrayBuffer });
    // A fresh file replaces whatever MARKET SHARE result was on screen — otherwise swapping
    // the upload would silently leave the old file's numbers displayed until re-generated.
    setMarketShareResult(null);
  };

  const handlePreviousCatalogueTotalsFile = async (file: File) => {
    if (!/\.xlsx$/i.test(file.name)) {
      setError("Please upload a .xlsx file (last week's ALL BROKERS CATALOGUED TOTALS workbook).");
      return;
    }
    setError(null);
    const arrayBuffer = await file.arrayBuffer();
    setPreviousCatalogueTotalsData({ fileName: file.name, arrayBuffer });
    setMarketShareResult(null);
  };

  /** MARKET SHARE alone: the catalogued-totals workbook is everything this output needs, so
   *  this never waits on the CBAC TXT / WES file the other cards require. The sale-number
   *  override field is reused when present (same field the rest of the page uses), else the
   *  file's own "Sale No:" cell (parsed by parseCatalogueTotals) is the source of truth. */
  const generateMarketShareOnly = async () => {
    if (!catalogueTotalsData || generatingMarketShare) return;
    setGeneratingMarketShare(true);
    setError(null);
    try {
      const overrideNumber = saleNumberOverride.trim() === "" ? undefined : parseInt(saleNumberOverride.trim(), 10);
      const report = await parseCatalogueTotals(catalogueTotalsData.arrayBuffer);
      const saleNumber = Number.isFinite(overrideNumber) ? (overrideNumber as number) : report.saleNumber;
      const result = await buildMarketShareWorkbook({ report, saleNumber });
      const warnings = [...result.warnings];
      let compareRowsByTable: Record<string, MarketShareCompareRow[]> | null = null;
      let previousSaleNumber: number | null = null;
      if (previousCatalogueTotalsData) {
        const prevReport = await parseCatalogueTotals(previousCatalogueTotalsData.arrayBuffer);
        warnings.push(...prevReport.warnings);
        const compare = buildMarketShareCompareRows({ current: report, previous: prevReport });
        warnings.push(...compare.warnings);
        compareRowsByTable = compare.rowsByTable;
        previousSaleNumber = prevReport.saleNumber;
      }
      setMarketShareResult({
        filename: result.filename,
        buffer: result.buffer,
        rowsByTable: result.rowsByTable,
        warnings,
        ok: report.brokers.length > 0,
        saleNumber,
        compareRowsByTable,
        previousSaleNumber,
      });
    } catch (e) {
      setError(e instanceof Error ? `Failed to build the MARKET SHARE workbook: ${e.message}` : "Failed to build the MARKET SHARE workbook.");
    } finally {
      setGeneratingMarketShare(false);
    }
  };

  const generate = async () => {
    if (!txtData || !wesSource) {
      setError("Provide the CBAC TXT report and the WES data (upload, or load from the database) before generating.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const overrideNumber = saleNumberOverride.trim() === "" ? undefined : parseInt(saleNumberOverride.trim(), 10);
      const wesInput: WesInput =
        wesSource.kind === "upload" ? { source: "upload", arrayBuffer: wesSource.arrayBuffer.slice(0) } : { source: "database", report: wesSource.report };
      const result = await runJob(
        txtData.text,
        wesInput,
        {
          saleDate: saleDate.trim() || undefined,
          saleNumber: Number.isFinite(overrideNumber) ? overrideNumber : undefined,
          rankHeaderText: rankHeaderText.trim() || undefined,
          lowHeaderText: lowHeaderText.trim() || undefined,
        },
        catalogueTotalsData?.arrayBuffer,
        previousCatalogueTotalsData?.arrayBuffer
      );
      setJob(result);
      // Fold this run's MARKET SHARE output (if any) into the same state the standalone
      // button writes to, so there's only ever one Market Share card regardless of which path
      // produced it.
      if (result.marketShareWorkbook?.buffer && result.marketShareWorkbook.filename) {
        setMarketShareResult({
          filename: result.marketShareWorkbook.filename,
          buffer: result.marketShareWorkbook.buffer,
          rowsByTable: result.marketShareRowsByTable,
          warnings: result.marketShareWarnings,
          ok: result.marketShareWorkbook.ok,
          saleNumber: result.saleNumber,
          compareRowsByTable: result.marketShareCompareRowsByTable,
          previousSaleNumber: result.previousSaleNumber,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? `Failed to process files: ${e.message}` : "Failed to process files.");
    } finally {
      setGenerating(false);
    }
  };

  const clearAll = () => {
    setTxtData(null);
    setWesSource(null);
    setCatalogueTotalsData(null);
    setPreviousCatalogueTotalsData(null);
    setMarketShareResult(null);
    setSaleDate("");
    setSaleNumberOverride("");
    setRankHeaderText("");
    setLowHeaderText("");
    setJob(null);
    setError(null);
  };

  const downloadFactPdf = async (outcome: WeeklyJobResult["outcomes"][number]) => {
    if (!job || pdfBusy || !outcome.buffer) return;
    const name = pdfNameOf(outcome.filename);
    setPdfBusy(name);
    setError(null);
    try {
      const blob = await api.convertWeeklyFactPdf(outcome.buffer, outcome.filename);
      triggerDownload(blob, name, "application/pdf");
    } catch (e) {
      setError(e instanceof Error ? `Failed to build the PDF: ${e.message}` : "Failed to build the PDF.");
    } finally {
      setPdfBusy(null);
    }
  };

  const downloadRankPdf = async () => {
    if (!job?.rankWorkbook?.filename || !job.rankWorkbook.buffer || pdfBusy) return;
    const name = pdfNameOf(job.rankWorkbook.filename);
    setPdfBusy(name);
    setError(null);
    try {
      const blob = await api.convertWeeklyFactPdf(job.rankWorkbook.buffer, job.rankWorkbook.filename);
      triggerDownload(blob, name, "application/pdf");
    } catch (e) {
      setError(e instanceof Error ? `Failed to build the PDF: ${e.message}` : "Failed to build the PDF.");
    } finally {
      setPdfBusy(null);
    }
  };

  const downloadLowPdf = async (variant: "rank" | "mark") => {
    const wbk = variant === "rank" ? job?.lowRankWorkbook : job?.lowMarkWorkbook;
    if (!job || !wbk?.filename || !wbk.buffer || pdfBusy) return;
    const name = pdfNameOf(wbk.filename);
    setPdfBusy(name);
    setError(null);
    try {
      const blob = await api.convertWeeklyFactPdf(wbk.buffer, wbk.filename);
      triggerDownload(blob, name, "application/pdf");
    } catch (e) {
      setError(e instanceof Error ? `Failed to build the PDF: ${e.message}` : "Failed to build the PDF.");
    } finally {
      setPdfBusy(null);
    }
  };

  // The plain PDF (this sale alone, like the sale-34 archive) — always available whenever
  // marketShareResult exists, regardless of whether a "last week" file was also attached.
  const downloadMarketSharePdf = async () => {
    if (!marketShareResult || pdfBusy) return;
    const name = pdfNameOf(marketShareResult.filename);
    setPdfBusy(name);
    setError(null);
    try {
      const blob = await buildMarketSharePdf(marketShareTablesOf(marketShareResult.rowsByTable), marketShareResult.saleNumber);
      triggerDownload(blob, name, "application/pdf");
    } catch (e) {
      setError(e instanceof Error ? `Failed to build the PDF: ${e.message}` : "Failed to build the PDF.");
    } finally {
      setPdfBusy(null);
    }
  };

  // The compare PDF (this sale vs. last week, like the sale-35 archive) — a second, separate
  // output that shows up alongside the plain one whenever a "last week" file was attached; it
  // never replaces the plain PDF, since both are wanted as two distinct downloads.
  const downloadMarketShareComparePdf = async () => {
    if (!marketShareResult?.compareRowsByTable || pdfBusy) return;
    const name = marketShareComparePdfName(marketShareResult.saleNumber);
    setPdfBusy(name);
    setError(null);
    try {
      const blob = await buildMarketShareComparePdf(
        marketShareCompareTablesOf(marketShareResult.compareRowsByTable),
        marketShareResult.saleNumber,
        marketShareResult.previousSaleNumber
      );
      triggerDownload(blob, name, "application/pdf");
    } catch (e) {
      setError(e instanceof Error ? `Failed to build the PDF: ${e.message}` : "Failed to build the PDF.");
    } finally {
      setPdfBusy(null);
    }
  };

  const downloadAllZip = async () => {
    if (!job && !marketShareResult) return;
    const buffers = job ? (job.outcomes.filter((o) => o.buffer) as { filename: string; buffer: ArrayBuffer }[]) : [];
    if (job?.rankWorkbook?.buffer) buffers.push({ filename: job.rankWorkbook.filename!, buffer: job.rankWorkbook.buffer });
    if (job?.lowRankWorkbook?.buffer) buffers.push({ filename: job.lowRankWorkbook.filename!, buffer: job.lowRankWorkbook.buffer });
    if (job?.lowMarkWorkbook?.buffer) buffers.push({ filename: job.lowMarkWorkbook.filename!, buffer: job.lowMarkWorkbook.buffer });
    if (marketShareResult) buffers.push({ filename: marketShareResult.filename, buffer: marketShareResult.buffer });
    if (!buffers.length) {
      setError("No generated files to zip.");
      return;
    }
    setZipping(true);
    setError(null);
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      buffers.forEach((o) => zip.file(o.filename, o.buffer));
      // The PDF mirror of every workbook rides along in the same ZIP, one .pdf per .xlsx.
      if (job) {
        for (const o of job.outcomes) {
          if (o.buffer) zip.file(pdfNameOf(o.filename), await api.convertWeeklyFactPdf(o.buffer, o.filename));
        }
        if (job.rankWorkbook?.buffer && job.rankWorkbook.filename) {
          zip.file(pdfNameOf(job.rankWorkbook.filename), await api.convertWeeklyFactPdf(job.rankWorkbook.buffer, job.rankWorkbook.filename));
        }
        if (job.lowRankWorkbook?.buffer && job.lowRankWorkbook.filename) {
          zip.file(pdfNameOf(job.lowRankWorkbook.filename), await api.convertWeeklyFactPdf(job.lowRankWorkbook.buffer, job.lowRankWorkbook.filename));
        }
        if (job.lowMarkWorkbook?.buffer && job.lowMarkWorkbook.filename) {
          zip.file(pdfNameOf(job.lowMarkWorkbook.filename), await api.convertWeeklyFactPdf(job.lowMarkWorkbook.buffer, job.lowMarkWorkbook.filename));
        }
      }
      if (marketShareResult) {
        // Always the plain PDF, plus the compare PDF alongside it (not instead of it) when a
        // "last week" file was attached — two distinct downloads, same as the two standalone
        // PDF buttons on the card below.
        zip.file(pdfNameOf(marketShareResult.filename), await buildMarketSharePdf(marketShareTablesOf(marketShareResult.rowsByTable), marketShareResult.saleNumber));
        if (marketShareResult.compareRowsByTable) {
          zip.file(
            marketShareComparePdfName(marketShareResult.saleNumber),
            await buildMarketShareComparePdf(
              marketShareCompareTablesOf(marketShareResult.compareRowsByTable),
              marketShareResult.saleNumber,
              marketShareResult.previousSaleNumber
            )
          );
        }
      }
      const content = await zip.generateAsync({ type: "blob" });
      const label = job?.saleNumber ?? marketShareResult?.saleNumber ?? "X";
      triggerDownload(content, `weekly_reports_sale${label}_${dateStamp()}.zip`, "application/zip");
    } catch {
      setError("Failed to build the ZIP file.");
    } finally {
      setZipping(false);
    }
  };

  const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const anyBuffers =
    (!!job && (job.outcomes.some((o) => o.buffer) || !!job.rankWorkbook?.buffer || !!job.lowRankWorkbook?.buffer || !!job.lowMarkWorkbook?.buffer)) ||
    !!marketShareResult;

  return (
    <div>
      {generating && <BusyOverlay message="Generating reports…" />}
      <PageHeader
        title="Weekly FACT Reports"
        subtitle="UVA/WESTERN High & Medium ranking workbooks plus the LOW RANK/MARK WISE pair and the MARKET SHARE workbook, rebuilt from the CBAC elevation-average release, the WES factory-wise sale workbook, and (optionally) the ALL BROKERS CATALOGUED TOTALS workbook."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>}

      <SectionLabel>1. Source files</SectionLabel>
      <div className="grid sm:grid-cols-2 gap-4 mb-5">
        <Dropzone label="CBAC weekly elevation average report" hint=".txt" accept=".txt" file={txtData} onFile={handleTxtFile} />

        <div className="border border-border rounded-lg bg-surface p-4">
          <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
            <h3 className="font-display text-[14px] font-semibold text-text-strong m-0">WES master factory-wise sale file</h3>
            <ToggleButtonGroup size="small" exclusive value={wesMode} onChange={(_, v) => v && setWesMode(v)}>
              <ToggleButton value="upload" sx={{ fontSize: 11.5, px: 1.25, py: 0.25 }}>
                <UploadFileOutlinedIcon sx={{ fontSize: 14, mr: 0.5 }} />
                Upload
              </ToggleButton>
              <ToggleButton value="database" sx={{ fontSize: 11.5, px: 1.25, py: 0.25 }}>
                <StorageOutlinedIcon sx={{ fontSize: 14, mr: 0.5 }} />
                Database
              </ToggleButton>
            </ToggleButtonGroup>
          </div>

          {wesMode === "upload" ? (
            <Dropzone label="" hint=".xlsx" accept=".xlsx" file={wesSource?.kind === "upload" ? { fileName: wesSource.fileName } : null} onFile={handleWesFile} />
          ) : dbSalesError ? (
            <div className="text-[12px] text-text-muted py-2">Couldn&apos;t load the sale list — switch to Upload instead.</div>
          ) : (
            <>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <TextField
                  select
                  size="small"
                  label="Year"
                  value={dbYear === "" ? "" : String(dbYear)}
                  disabled={!dbSales || dbSales.length === 0}
                  onChange={(e) => {
                    const y = Number(e.target.value);
                    setDbYear(y);
                    const forYear = (dbSales ?? []).filter((s) => s.year === y).sort((a, b) => b.saleNo - a.saleNo);
                    setDbSaleNo(forYear[0]?.saleNo ?? "");
                  }}
                >
                  {dbYears.map((y) => (
                    <MenuItem key={y} value={y}>
                      {y}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  select
                  size="small"
                  label="Sale No"
                  value={dbSaleNo === "" ? "" : String(dbSaleNo)}
                  disabled={dbSalesForYear.length === 0}
                  onChange={(e) => setDbSaleNo(Number(e.target.value))}
                >
                  {dbSalesForYear.map((s) => (
                    <MenuItem key={s.saleNo} value={s.saleNo}>
                      Sale {s.saleNo} — {new Date(s.saleDate).toLocaleDateString("en-GB")}
                    </MenuItem>
                  ))}
                </TextField>
              </div>
              <Button
                fullWidth
                variant="outlined"
                size="small"
                startIcon={dbLoading ? <CircularProgress size={14} /> : <StorageOutlinedIcon fontSize="small" />}
                disabled={dbYear === "" || dbSaleNo === "" || dbLoading}
                onClick={loadWesFromDatabase}
              >
                {dbLoading ? "Loading…" : "Load from database"}
              </Button>
              <p className="text-[11px] text-text-muted mt-1.5 mb-0 leading-relaxed">
                Only sales already imported are listed. Week-level figures match the real WES file almost exactly; year-to-date can
                drift slightly — review the generated reports before sending them out.
              </p>
            </>
          )}

          <LoadedLine
            ready={!!wesSource}
            text={
              wesSource
                ? wesSource.kind === "upload"
                  ? `Using upload: ${wesSource.fileName}`
                  : `Using database: Sale ${wesSource.saleNo} of ${wesSource.saleYear} (${wesSource.categoryCounts.reduce((n, [, c]) => n + c, 0)} factory rows)`
                : "No WES data loaded yet."
            }
          />
        </div>

        <div className="border border-border rounded-lg bg-surface p-4 sm:col-span-2">
          <div className="flex items-center gap-2 mb-3">
            <h3 className="font-display text-[14px] font-semibold text-text-strong m-0">ALL BROKERS CATALOGUED TOTALS</h3>
            <span className="text-[11px] text-text-muted font-mono uppercase tracking-wide">Optional — adds the MARKET SHARE workbook</span>
          </div>
          <Dropzone
            label=""
            hint=".xlsx — the market-wide, all-broker catalogued-totals workbook (drives MARKET SHARE only)"
            accept=".xlsx"
            file={catalogueTotalsData ? { fileName: catalogueTotalsData.fileName } : null}
            onFile={handleCatalogueTotalsFile}
          />

          <div className="mt-3 pt-3 border-t border-border">
            <div className="flex items-center gap-2 mb-2">
              <h4 className="font-display text-[12.5px] font-semibold text-text-strong m-0">Last week&apos;s catalogued totals</h4>
              <span className="text-[11px] text-text-muted font-mono uppercase tracking-wide">Optional — adds THIS/LAST WEEK compare columns</span>
            </div>
            <Dropzone
              label=""
              hint=".xlsx — the immediately-preceding sale's own catalogued-totals workbook"
              accept=".xlsx"
              file={previousCatalogueTotalsData ? { fileName: previousCatalogueTotalsData.fileName } : null}
              onFile={handlePreviousCatalogueTotalsFile}
            />
            {previousCatalogueTotalsData && (
              <div className="mt-2">
                <Button
                  size="small"
                  onClick={() => {
                    setPreviousCatalogueTotalsData(null);
                    setMarketShareResult(null);
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
          </div>

          {catalogueTotalsData && (
            <div className="flex gap-2 mt-3 flex-wrap items-center">
              <Button
                variant="outlined"
                size="small"
                startIcon={generatingMarketShare ? <CircularProgress size={14} /> : undefined}
                disabled={generatingMarketShare}
                onClick={generateMarketShareOnly}
              >
                {generatingMarketShare ? "Generating…" : "Generate Market Share"}
              </Button>
              <Button
                size="small"
                onClick={() => {
                  setCatalogueTotalsData(null);
                  setPreviousCatalogueTotalsData(null);
                  setMarketShareResult(null);
                }}
              >
                Remove
              </Button>
              <span className="text-[11px] text-text-muted leading-relaxed">
                Works from this one file alone — no need to also provide the CBAC TXT / WES pair unless you want the other workbooks too.
                {previousCatalogueTotalsData ? " The compare report (THIS/LAST WEEK) will be generated since last week's file is attached." : ""}
              </span>
            </div>
          )}
        </div>
      </div>

      <Accordion
        expanded={advancedOpen}
        onChange={(_, v) => setAdvancedOpen(v)}
        disableGutters
        square={false}
        sx={{
          border: "1px solid var(--border)",
          borderRadius: "8px !important",
          bgcolor: "var(--surface) !important",
          boxShadow: "none",
          mb: 3,
          "&:before": { display: "none" },
        }}
      >
        <AccordionSummary expandIcon={<ExpandMoreIcon />}>
          <div className="flex items-center gap-2 text-[13px] font-semibold text-text-strong">
            <TuneOutlinedIcon sx={{ fontSize: 17 }} />
            Sale details &amp; header text
            <span className="font-normal text-text-muted">
              {saleDate || saleNumberOverride ? ` — Sale ${saleNumberOverride || "?"}, ${saleDate || "date auto"}` : " (auto-filled from the TXT)"}
            </span>
          </div>
        </AccordionSummary>
        <AccordionDetails sx={{ pt: 0 }}>
          <div className="grid sm:grid-cols-2 gap-3 mb-3.5">
            <TextField
              size="small"
              label="Sale date (report header)"
              placeholder="Auto, from TXT"
              value={saleDate}
              onChange={(e) => setSaleDate(e.target.value)}
            />
            <TextField
              size="small"
              label="Sale No (report header)"
              placeholder="Auto, from TXT"
              value={saleNumberOverride}
              onChange={(e) => setSaleNumberOverride(e.target.value)}
            />
          </div>
          <TextField
            size="small"
            fullWidth
            label="RANK workbook header text"
            helperText="Auto-filled from the sale date — check it against the real date range before generating; it's typed by hand each week in practice, so spacing/wording can vary."
            placeholder="e.g. Sale No. 30- 04TH AUG / 05TH AUG 2026"
            value={rankHeaderText}
            onChange={(e) => setRankHeaderText(e.target.value)}
            sx={{ mb: 2 }}
          />
          <TextField
            size="small"
            fullWidth
            label="RANK/MARK WISE (LOW) workbooks header text"
            helperText="The LOW workbooks' own date-range line (a different hand-typed format from the RANK one) — auto-filled from the sale date, editable the same way."
            placeholder="e.g.  Sale No. 31 - 11th  / 12th  AUGUST 2026"
            value={lowHeaderText}
            onChange={(e) => setLowHeaderText(e.target.value)}
          />
        </AccordionDetails>
      </Accordion>

      <div className="flex gap-2 flex-wrap mb-5">
        <Button variant="contained" size="large" onClick={generate} disabled={!txtData || !wesSource || generating}>
          {generating ? "Generating…" : "Generate reports"}
        </Button>
        <Button variant="outlined" size="large" onClick={clearAll}>
          Clear all
        </Button>
      </div>

      {job || marketShareResult ? (
        <>
          <div className="border border-border rounded-lg bg-surface p-4 mb-4 flex items-center justify-between flex-wrap gap-3">
            <div>
              <h2 className="font-display text-lg font-semibold text-text-strong m-0">
                {job?.saleNumber != null ? `Sale ${job.saleNumber}` : marketShareResult?.saleNumber != null ? `Sale ${marketShareResult.saleNumber}` : "Sale —"}
                {job?.saleDate ? ` — ${job.saleDate}` : ""}
              </h2>
              {job && <Warnings warnings={job.warnings} tone="warning" />}
            </div>
            {anyBuffers && (
              <Button variant="contained" startIcon={<FolderZipOutlinedIcon fontSize="small" />} onClick={downloadAllZip} disabled={zipping}>
                {zipping ? "Building ZIP…" : "Download all as ZIP"}
              </Button>
            )}
          </div>

          {job && (
            <>
          <SectionLabel>FACT ranking workbooks</SectionLabel>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
            {job.outcomes.map((o) => (
              <ResultCard
                key={o.category}
                eyebrow={o.category}
                count={o.rowCount}
                countLabel="estate rows"
                ok={o.ok}
                hasBuffer={!!o.buffer}
                downloadLabel={`Download ${o.filename}`}
                onDownload={() => o.buffer && triggerDownload(o.buffer, o.filename, xlsxType)}
                pdfName={pdfNameOf(o.filename)}
                pdfLabel={`PDF — ${pdfNameOf(o.filename)}`}
                pdfBusy={pdfBusy}
                onPdf={() => downloadFactPdf(o)}
                warnings={o.warnings}
                description={
                  <>
                    Sale Avr: <strong>{fmtAvg(o.benchmark[0])}</strong>
                    <br />
                    MTD Avr: <strong>{fmtAvg(o.benchmark[1])}</strong>
                    <br />
                    YTD Avr: <strong>{fmtAvg(o.benchmark[2])}</strong>
                  </>
                }
              />
            ))}
          </div>

          {job.rankWorkbook && (
            <>
              <SectionLabel>Combined RANK workbook</SectionLabel>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                <ResultCard
                  eyebrow="RANK FAC (combined)"
                  count={5}
                  countLabel="sheets — WM, Sheet1, WH, UM, UH"
                  ok={job.rankWorkbook.ok}
                  hasBuffer={!!job.rankWorkbook.buffer}
                  downloadLabel={`Download ${job.rankWorkbook.filename}`}
                  onDownload={() => job.rankWorkbook?.buffer && triggerDownload(job.rankWorkbook.buffer, job.rankWorkbook.filename!, xlsxType)}
                  pdfName={job.rankWorkbook.filename ? pdfNameOf(job.rankWorkbook.filename) : null}
                  pdfLabel="PDF — category tabs (Sheet1 excluded)"
                  pdfBusy={pdfBusy}
                  onPdf={downloadRankPdf}
                  warnings={job.rankWarnings}
                  description="Sheet1 is a raw copy of the WES file; each category tab lists only estates that sold this week, ranked, with a DEF +/- vs the month-todate benchmark."
                />
              </div>
            </>
          )}

          {(job.lowRankWorkbook || job.lowMarkWorkbook) && (
            <>
              <SectionLabel>LOW RANK/MARK WISE workbooks</SectionLabel>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                {(
                  [
                    {
                      variant: "rank" as const,
                      wbk: job.lowRankWorkbook,
                      rows: job.lowRankRows,
                      label: "RANK WISE (LOW)",
                      blurb: "The WES file's LOW block ranked by month-todate rank, with the LOW-ORTHODOX benchmarks and a DEF +/- formula per row.",
                    },
                    {
                      variant: "mark" as const,
                      wbk: job.lowMarkWorkbook,
                      rows: job.lowMarkRows,
                      label: "MARK WISE (LOW)",
                      blurb: "The same LOW sheet sorted alphabetically by factory name — identical data to RANK WISE, different row order.",
                    },
                  ]
                ).map(({ variant, wbk, rows, label, blurb }) =>
                  wbk ? (
                    <ResultCard
                      key={variant}
                      eyebrow={label}
                      count={rows.length}
                      countLabel="factory rows"
                      ok={wbk.ok}
                      hasBuffer={!!wbk.buffer}
                      downloadLabel={`Download ${wbk.filename}`}
                      onDownload={() => wbk.buffer && triggerDownload(wbk.buffer, wbk.filename!, xlsxType)}
                      pdfName={wbk.filename ? pdfNameOf(wbk.filename) : null}
                      pdfLabel={`PDF — ${wbk.filename ? pdfNameOf(wbk.filename) : "…"}`}
                      pdfBusy={pdfBusy}
                      onPdf={() => downloadLowPdf(variant)}
                      warnings={job.lowWarnings}
                      description={
                        <>
                          {blurb}
                          <br />
                          Weekly Avg: <strong>{fmtAvg(job.lowBenchmark[0])}</strong> · MTD Avg: <strong>{fmtAvg(job.lowBenchmark[1])}</strong>
                        </>
                      }
                    />
                  ) : null
                )}
              </div>
            </>
          )}
            </>
          )}

          {marketShareResult && (
            <>
              <SectionLabel>MARKET SHARE workbook</SectionLabel>
              <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-5">
                <ResultCard
                  eyebrow="MARKET SHARE"
                  count={MARKET_SHARE_TABLE_SPECS.reduce((n, s) => n + (marketShareResult.rowsByTable[s.field]?.length ?? 0), 0)}
                  countLabel="broker rows across 4 tables"
                  ok={marketShareResult.ok}
                  hasBuffer={!!marketShareResult.buffer}
                  downloadLabel={`Download ${marketShareResult.filename}`}
                  onDownload={() => triggerDownload(marketShareResult.buffer, marketShareResult.filename, xlsxType)}
                  pdfName={pdfNameOf(marketShareResult.filename)}
                  pdfLabel="PDF — this sale (Total / Ex-Estate / High & Medium / Low)"
                  pdfBusy={pdfBusy}
                  onPdf={downloadMarketSharePdf}
                  secondaryPdf={
                    marketShareResult.compareRowsByTable
                      ? {
                          name: marketShareComparePdfName(marketShareResult.saleNumber),
                          label: `PDF — compare vs Sale ${marketShareResult.previousSaleNumber ?? "?"}`,
                          onPdf: downloadMarketShareComparePdf,
                        }
                      : null
                  }
                  warnings={marketShareResult.warnings}
                  description={
                    marketShareResult.compareRowsByTable
                      ? `Total / Ex-Estate / High & Medium / Low market share, each ranked by quantity — top 3 per table highlighted. Two PDFs available: this sale alone, and compared vs Sale ${marketShareResult.previousSaleNumber ?? "?"} (THIS/LAST WEEK qty and +/-).`
                      : "Total / Ex-Estate / High & Medium / Low market share, each ranked by quantity from the catalogued-totals workbook — top 3 per table highlighted, exactly like the archives."
                  }
                />
              </div>
            </>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-text-muted border border-dashed border-border rounded-lg">
          No reports generated yet. Provide the CBAC TXT report and the WES data and click &quot;Generate reports&quot; — or just the ALL BROKERS
          CATALOGUED TOTALS file and click &quot;Generate Market Share&quot; above for that workbook alone.
        </div>
      )}
    </div>
  );
}
