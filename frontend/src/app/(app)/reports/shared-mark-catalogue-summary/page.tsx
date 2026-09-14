"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import WarningsConfirmDialog from "@/components/shared/WarningsConfirmDialog";
import { api } from "@/lib/api";
import type { ScheduledReportOutput } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

// Matches BrokerCode.All on the backend (Modules/MarkIntelligence/BrokerCatalogueUploadParser.cs)
// exactly — order, codes, and which code each broker's raw file identifies as (not always what
// the file itself or its own filename says — MB's own file says "MB", but the canonical code
// everywhere else in this app is "MPB"; AEB's file says "EB").
const BROKER_SLOTS: { code: string; label: string }[] = [
  { code: "ASC", label: "ASC (your own catalogue)" },
  { code: "EB", label: "AEB" },
  { code: "BC", label: "BC" },
  { code: "JK", label: "JK" },
  { code: "LC", label: "LCBL" },
  { code: "MPB", label: "MB / MPB" },
  { code: "FW", label: "FW" },
  { code: "CT", label: "CTB" },
];

type UploadMode = "zip" | "individual";

export default function SharedMarkCatalogueSummaryPage() {
  const [uploadMode, setUploadMode] = useState<UploadMode>("zip");
  const [zipFile, setZipFile] = useState<File | undefined>(undefined);
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [saleYear, setSaleYear] = useState(new Date().getFullYear());
  const [saleNo, setSaleNo] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [outputs, setOutputs] = useState<ScheduledReportOutput[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [convertingPdfId, setConvertingPdfId] = useState<string | null>(null);
  const [unmatchedMarks, setUnmatchedMarks] = useState<string[]>([]);
  const [detectingSaleInfo, setDetectingSaleInfo] = useState(false);
  const [saleInfoWarnings, setSaleInfoWarnings] = useState<string[]>([]);
  // Set once the pre-flight preview call comes back with row/broker-quality warnings — held
  // here until the user explicitly accepts via WarningsConfirmDialog. Cancel leaves the chosen
  // files in place and generates nothing; nothing is persisted until Confirm.
  const [pendingGenerate, setPendingGenerate] = useState<{ warnings: string[] } | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const zipInputRef = useRef<HTMLInputElement | null>(null);

  const refresh = () => {
    api.listSharedMarkCatalogueSummaryOutputs().then(setOutputs).catch(() => setOutputs([]));
  };
  useEffect(() => {
    refresh();
  }, []);

  // Most of the 8 broker files already carry their own sale year/number/date, so as soon as
  // there's something to read (a zip, or even just the first individual file picked), ask the
  // backend for its best guess and pre-fill the form fields — they stay fully editable, this is
  // only ever a starting point, never a lock. Never blocks or errors: a failed/empty detection
  // just leaves the fields as they were.
  const detectAndFillSaleInfo = async (opts: { zipFile: File } | { files: Record<string, File | undefined> }) => {
    setDetectingSaleInfo(true);
    try {
      const detected = await api.detectSharedMarkCatalogueSaleInfo(opts);
      if (detected.saleYear) setSaleYear(detected.saleYear);
      if (detected.saleNo) setSaleNo(String(detected.saleNo));
      if (detected.saleDate) setSaleDate(detected.saleDate);
      setSaleInfoWarnings(detected.warnings);
    } catch {
      // best-effort only — leave whatever's already in the fields
    } finally {
      setDetectingSaleInfo(false);
    }
  };

  const allFilesChosen = BROKER_SLOTS.every((s) => files[s.code]);
  // Named individually (not just true/false) so the button can say exactly what's still
  // needed — a plain disabled button gave no clue why, and its disabled state renders pale
  // enough (MUI default) that it read as "there's no button at all" rather than "not yet".
  const missingForGenerate: string[] = [];
  if (!saleNo.trim()) missingForGenerate.push("Sale No");
  if (!saleDate) missingForGenerate.push("Sale Date");
  if (uploadMode === "zip" ? !zipFile : !allFilesChosen) missingForGenerate.push(uploadMode === "zip" ? "the zip file" : "all 8 files");
  const canGenerate = missingForGenerate.length === 0;

  const runGenerate = async () => {
    const saleNoNum = parseInt(saleNo, 10);
    setGenerating(true);
    setError(null);
    setUnmatchedMarks([]);
    try {
      const { unmatchedMarks: unmatched } =
        uploadMode === "zip"
          ? await api.generateSharedMarkCatalogueSummaryFromZip(zipFile!, saleYear, saleNoNum, saleDate)
          : await api.generateSharedMarkCatalogueSummaryFromUpload(files as Record<string, File>, saleYear, saleNoNum, saleDate);
      setUnmatchedMarks(unmatched);
      setZipFile(undefined);
      setFiles({});
      setSaleInfoWarnings([]);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate this report from the uploaded files");
    } finally {
      setGenerating(false);
    }
  };

  // Pre-flight: parse every broker file the same way generation would, without persisting
  // anything, so a "some rows look off — continue anyway?" checkpoint can happen before the
  // real generate call (which parses AND saves in one step, with no undo).
  const generateFromUpload = async () => {
    const saleNoNum = parseInt(saleNo, 10);
    if (!saleYear || !saleNoNum || !saleDate) return;
    if (uploadMode === "zip" && !zipFile) return;
    if (uploadMode === "individual" && !allFilesChosen) return;

    setGenerating(true);
    setError(null);
    try {
      const preview =
        uploadMode === "zip"
          ? await api.previewSharedMarkCatalogueSummaryFromZip(zipFile!, saleYear, saleNoNum)
          : await api.previewSharedMarkCatalogueSummaryFromUpload(files as Record<string, File>, saleYear, saleNoNum);
      if (preview.warnings.length === 0) await runGenerate();
      else {
        setGenerating(false);
        setPendingGenerate({ warnings: preview.warnings });
      }
    } catch (e) {
      setGenerating(false);
      setError(e instanceof Error ? e.message : "Couldn't check the uploaded files");
    }
  };

  const download = async (o: ScheduledReportOutput) => {
    setDownloadingId(o.id);
    try {
      const { blob, fileName } = await api.downloadSavedReport(o.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? `${o.title}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  const downloadPdf = async (o: ScheduledReportOutput) => {
    setConvertingPdfId(o.id);
    setError(null);
    try {
      const { blob, fileName } = await api.downloadSavedReport(o.id);
      const buffer = await blob.arrayBuffer();
      const stem = (fileName ?? `${o.title}.xlsx`).replace(/\.xlsx$/i, "");
      const pdfBlob = await api.convertXlsxToPdf(buffer, stem);
      const url = URL.createObjectURL(pdfBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${stem}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't convert this report to PDF");
    } finally {
      setConvertingPdfId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Sharing Mark Catalogued Summary"
        subtitle="Every estate ASC shares with another Colombo broker — catalogued Sale/MTD/YTD quantity per side, split Low Grown vs High & Medium Grown."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      {unmatchedMarks.length > 0 && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-info bg-info-light text-sm text-info">
          <strong>{unmatchedMarks.length}</strong> mark{unmatchedMarks.length === 1 ? "" : "s"} had no prior catalogue history to
          confirm Low Grown vs High &amp; Medium Grown, and {unmatchedMarks.length === 1 ? "was" : "were"} defaulted to High &amp;
          Medium Grown — please verify manually: {unmatchedMarks.join(", ")}.
        </div>
      )}

      <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-1">Generate from broker files</h3>
        <p className="text-[12px] text-text-muted m-0 mb-3">
          This report can&apos;t wait for a sale to close — these are pre-sale catalogues, shared by every broker before the
          auction happens. All 8 brokers&apos; files are required: the report needs both ASC&apos;s own figures and every
          other broker&apos;s to know which estates are actually shared.
        </p>

        <div className="flex items-end gap-2 flex-wrap mb-3">
          <TextField
            label="Sale Year"
            type="number"
            size="small"
            value={saleYear}
            onChange={(e) => setSaleYear(parseInt(e.target.value, 10) || saleYear)}
            sx={{ width: 110 }}
          />
          <TextField label="Sale No" size="small" value={saleNo} onChange={(e) => setSaleNo(e.target.value)} sx={{ width: 90 }} />
          <TextField
            label="Sale Date"
            type="date"
            size="small"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 160 }}
          />
          {detectingSaleInfo && (
            <span className="flex items-center gap-1.5 text-[12px] text-text-muted">
              <CircularProgress size={12} />
              Reading sale details from the file…
            </span>
          )}
        </div>

        {saleInfoWarnings.length > 0 && (
          <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-info bg-info-light text-[12px] text-info">
            {saleInfoWarnings.join(" ")}
          </div>
        )}

        <div className="flex gap-1 mb-3">
          <Button
            size="small"
            variant={uploadMode === "zip" ? "contained" : "outlined"}
            onClick={() => setUploadMode("zip")}
            sx={{ textTransform: "none" }}
          >
            Upload one zip
          </Button>
          <Button
            size="small"
            variant={uploadMode === "individual" ? "contained" : "outlined"}
            onClick={() => setUploadMode("individual")}
            sx={{ textTransform: "none" }}
          >
            Upload 8 files individually
          </Button>
        </div>

        {uploadMode === "zip" ? (
          <div className="mb-3">
            <p className="text-[12px] text-text-muted m-0 mb-2">
              A zip containing all 8 broker files — each one&apos;s broker is detected automatically from its own contents, so
              the files inside can be named anything and in any order.
            </p>
            <input
              ref={zipInputRef}
              type="file"
              accept=".zip"
              hidden
              onChange={(e) => {
                const f = e.target.files?.[0];
                setZipFile(f);
                if (f) detectAndFillSaleInfo({ zipFile: f });
              }}
            />
            <Button
              size="small"
              variant={zipFile ? "outlined" : "text"}
              color={zipFile ? "success" : "inherit"}
              startIcon={zipFile ? <CheckCircleOutlinedIcon fontSize="small" /> : <UploadFileOutlinedIcon fontSize="small" />}
              onClick={() => zipInputRef.current?.click()}
              sx={{ textTransform: "none" }}
              title={zipFile?.name}
            >
              {zipFile ? zipFile.name : "Choose zip file"}
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
            {BROKER_SLOTS.map((slot) => {
              const chosen = files[slot.code];
              return (
                <div key={slot.code}>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[slot.code] = el;
                    }}
                    type="file"
                    accept=".xls,.xlsx"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      setFiles((prev) => {
                        const next = { ...prev, [slot.code]: f };
                        if (f) detectAndFillSaleInfo({ files: next });
                        return next;
                      });
                    }}
                  />
                  <Button
                    fullWidth
                    size="small"
                    variant={chosen ? "outlined" : "text"}
                    color={chosen ? "success" : "inherit"}
                    startIcon={chosen ? <CheckCircleOutlinedIcon fontSize="small" /> : <UploadFileOutlinedIcon fontSize="small" />}
                    onClick={() => fileInputRefs.current[slot.code]?.click()}
                    sx={{ justifyContent: "flex-start", textTransform: "none" }}
                    title={chosen?.name}
                  >
                    <span className="truncate">{chosen ? slot.label : slot.label}</span>
                  </Button>
                </div>
              );
            })}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Tooltip title={!generating && missingForGenerate.length > 0 ? `Still need: ${missingForGenerate.join(", ")}` : ""}>
            <span>
              <Button
                size="small"
                variant="contained"
                startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlinedIcon fontSize="small" />}
                onClick={generateFromUpload}
                disabled={generating || !canGenerate}
              >
                {generating ? "Generating…" : "Generate report"}
              </Button>
            </span>
          </Tooltip>
          {!generating && missingForGenerate.length > 0 && (
            <span className="text-[12px] text-text-muted">Still need: {missingForGenerate.join(", ")}</span>
          )}
        </div>
      </div>

      <div className="border border-border rounded-[var(--radius-lg)] p-4" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">Generated reports</h3>
        {outputs === null ? (
          <div className="flex justify-center py-8">
            <TeaLoader size={36} />
          </div>
        ) : outputs.length === 0 ? (
          <p className="text-[12px] text-text-muted m-0">Nothing generated yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {outputs.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-[13px] border-b border-border last:border-b-0 py-2">
                <span className="flex-1 min-w-0 truncate text-text-strong">{o.title}</span>
                <span className="font-mono text-[12px] text-text-muted shrink-0">{new Date(o.createdAt).toLocaleString()}</span>
                {o.downloadable ? (
                  <>
                    <Tooltip title="Download Excel">
                      <span>
                        <IconButton size="small" onClick={() => download(o)} disabled={downloadingId === o.id} aria-label={`Download ${o.title} (Excel)`}>
                          {downloadingId === o.id ? <CircularProgress size={16} /> : <DownloadOutlinedIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="Download PDF">
                      <span>
                        <IconButton size="small" onClick={() => downloadPdf(o)} disabled={convertingPdfId === o.id} aria-label={`Download ${o.title} (PDF)`}>
                          {convertingPdfId === o.id ? <CircularProgress size={16} /> : <PictureAsPdfOutlinedIcon fontSize="small" />}
                        </IconButton>
                      </span>
                    </Tooltip>
                  </>
                ) : (
                  <span className="text-[11px] text-text-muted italic shrink-0">{o.notes}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <WarningsConfirmDialog
        open={pendingGenerate !== null}
        title="Review before generating"
        warnings={pendingGenerate?.warnings ?? []}
        busy={generating}
        confirmLabel="Generate anyway"
        onCancel={() => setPendingGenerate(null)}
        onConfirm={async () => {
          setPendingGenerate(null);
          await runGenerate();
        }}
      />
    </div>
  );
}
