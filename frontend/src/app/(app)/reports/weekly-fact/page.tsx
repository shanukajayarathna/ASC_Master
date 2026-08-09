"use client";

import PageHeader from "@/components/shared/PageHeader";
import { dateStamp } from "@/lib/worksheetPdf";
import { computeDefaultRankHeaderText, runJob, type WeeklyJobResult } from "@/lib/weeklyFactReport";
import CheckCircleOutlineIcon from "@mui/icons-material/CheckCircleOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import FolderZipOutlinedIcon from "@mui/icons-material/FolderZipOutlined";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useRef, useState } from "react";

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
      <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">{label}</h3>
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

export default function WeeklyFactReportsPage() {
  const [txtData, setTxtData] = useState<{ fileName: string; text: string } | null>(null);
  const [wesData, setWesData] = useState<{ fileName: string; arrayBuffer: ArrayBuffer } | null>(null);
  const [saleDate, setSaleDate] = useState("");
  const [saleNumberOverride, setSaleNumberOverride] = useState("");
  // Auto-filled once the TXT is read (see handleTxtFile), but always left editable — the real
  // RANK archives show this date-range text typed by hand each week with its own inconsistent
  // spacing/abbreviation, so no formula can promise a byte-perfect match; this field is how a
  // computed best guess gets corrected to match exactly when it needs to.
  const [rankHeaderText, setRankHeaderText] = useState("");

  const [generating, setGenerating] = useState(false);
  const [zipping, setZipping] = useState(false);
  const [job, setJob] = useState<WeeklyJobResult | null>(null);
  const [error, setError] = useState<string | null>(null);

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
    setWesData({ fileName: file.name, arrayBuffer });
  };

  const generate = async () => {
    if (!txtData || !wesData) {
      setError("Upload both the CBAC TXT report and the WES master file before generating.");
      return;
    }
    setGenerating(true);
    setError(null);
    try {
      const overrideNumber = saleNumberOverride.trim() === "" ? undefined : parseInt(saleNumberOverride.trim(), 10);
      const result = await runJob(txtData.text, wesData.arrayBuffer.slice(0), {
        saleDate: saleDate.trim() || undefined,
        saleNumber: Number.isFinite(overrideNumber) ? overrideNumber : undefined,
        rankHeaderText: rankHeaderText.trim() || undefined,
      });
      setJob(result);
    } catch (e) {
      setError(e instanceof Error ? `Failed to process files: ${e.message}` : "Failed to process files.");
    } finally {
      setGenerating(false);
    }
  };

  const clearAll = () => {
    setTxtData(null);
    setWesData(null);
    setSaleDate("");
    setSaleNumberOverride("");
    setRankHeaderText("");
    setJob(null);
    setError(null);
  };

  const downloadAllZip = async () => {
    if (!job) return;
    const buffers = job.outcomes.filter((o) => o.buffer) as { filename: string; buffer: ArrayBuffer }[];
    if (job.rankWorkbook?.buffer) buffers.push({ filename: job.rankWorkbook.filename!, buffer: job.rankWorkbook.buffer });
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
      const content = await zip.generateAsync({ type: "blob" });
      const label = job.saleNumber != null ? job.saleNumber : "X";
      triggerDownload(content, `weekly_reports_sale${label}_${dateStamp()}.zip`, "application/zip");
    } catch {
      setError("Failed to build the ZIP file.");
    } finally {
      setZipping(false);
    }
  };

  const xlsxType = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  const anyBuffers = !!job && (job.outcomes.some((o) => o.buffer) || !!job.rankWorkbook?.buffer);

  return (
    <div>
      <PageHeader
        title="Weekly FACT Reports"
        subtitle="UVA/WESTERN High & Medium ranking workbooks, rebuilt from the CBAC elevation-average release and the WES factory-wise sale workbook."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>}

      <div className="grid sm:grid-cols-2 gap-4 mb-4">
        <Dropzone label="CBAC weekly elevation average report" hint=".txt" accept=".txt" file={txtData} onFile={handleTxtFile} />
        <Dropzone label="WES master factory-wise sale file" hint=".xlsx" accept=".xlsx" file={wesData} onFile={handleWesFile} />
      </div>

      <div className="border border-border rounded-lg bg-surface p-4 mb-5">
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
        <div className="flex gap-2 flex-wrap">
          <Button variant="contained" onClick={generate} disabled={!txtData || !wesData || generating}>
            {generating ? "Generating…" : "Generate reports"}
          </Button>
          <Button variant="outlined" onClick={clearAll}>
            Clear uploads
          </Button>
        </div>
      </div>

      {job ? (
        <>
          <div className="border border-border rounded-lg bg-surface p-4 mb-4">
            <h2 className="font-display text-lg font-semibold text-text-strong m-0">
              {job.saleNumber != null ? `Sale ${job.saleNumber}` : "Sale —"}
              {job.saleDate ? ` — ${job.saleDate}` : ""}
            </h2>
            <Warnings warnings={job.warnings} tone="warning" />
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-4">
            {job.outcomes.map((o) => (
              <div
                key={o.category}
                className="border rounded-lg bg-surface p-4"
                style={{ borderColor: o.ok ? "var(--brass)" : "var(--border)" }}
              >
                <div className="text-[11px] font-medium text-text-muted">{o.category}</div>
                <div className="font-display text-2xl font-bold text-text-strong">{o.rowCount}</div>
                <div className="text-[11px] text-text-muted mb-2.5">estate rows</div>
                <div className="text-[12.5px] leading-relaxed text-text-strong">
                  Sale Avr: <strong>{fmtAvg(o.benchmark[0])}</strong>
                  <br />
                  MTD Avr: <strong>{fmtAvg(o.benchmark[1])}</strong>
                  <br />
                  YTD Avr: <strong>{fmtAvg(o.benchmark[2])}</strong>
                </div>
                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadOutlinedIcon fontSize="small" />}
                  sx={{ mt: 1.75, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
                  disabled={!o.buffer}
                  onClick={() => o.buffer && triggerDownload(o.buffer, o.filename, xlsxType)}
                >
                  {o.buffer ? `Download ${o.filename}` : "Not generated"}
                </Button>
                <Warnings warnings={o.warnings} tone={o.ok ? "warning" : "danger"} />
              </div>
            ))}

            {job.rankWorkbook && (
              <div
                className="border rounded-lg bg-surface p-4"
                style={{ borderColor: job.rankWorkbook.ok ? "var(--brass)" : "var(--border)" }}
              >
                <div className="text-[11px] font-medium text-text-muted">RANK FAC (combined)</div>
                <div className="font-display text-2xl font-bold text-text-strong">5</div>
                <div className="text-[11px] text-text-muted mb-2.5">sheets — WM, Sheet1, WH, UM, UH</div>
                <div className="text-[12.5px] leading-relaxed text-text-strong">
                  Sheet1 is a raw copy of the WES file; each category tab lists only estates that sold this week, ranked, with a DEF
                  +/- vs the month-todate benchmark.
                </div>
                <Button
                  fullWidth
                  variant="outlined"
                  size="small"
                  startIcon={<DownloadOutlinedIcon fontSize="small" />}
                  sx={{ mt: 1.75, whiteSpace: "normal", wordBreak: "break-word", lineHeight: 1.3 }}
                  disabled={!job.rankWorkbook.buffer}
                  onClick={() => job.rankWorkbook?.buffer && triggerDownload(job.rankWorkbook.buffer, job.rankWorkbook.filename!, xlsxType)}
                >
                  {job.rankWorkbook.buffer ? `Download ${job.rankWorkbook.filename}` : "Not generated"}
                </Button>
                <Warnings warnings={job.rankWarnings} tone={job.rankWorkbook.ok ? "warning" : "danger"} />
              </div>
            )}
          </div>

          {anyBuffers && (
            <Button variant="contained" startIcon={<FolderZipOutlinedIcon fontSize="small" />} onClick={downloadAllZip} disabled={zipping}>
              {zipping ? "Building ZIP…" : "Download all as ZIP"}
            </Button>
          )}
        </>
      ) : (
        <div className="text-center py-16 text-text-muted border border-dashed border-border rounded-lg">
          No reports generated yet. Upload the CBAC TXT report and the WES master file, then click &quot;Generate reports&quot;.
        </div>
      )}
    </div>
  );
}
