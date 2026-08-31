"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import AuctionReportView from "@/components/reports/AuctionReportView";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { exportCombinedReportExcel, exportCombinedReportPdf } from "@/lib/combinedReportExport";
import type { AuctionReport, CombinedReport } from "@/types/api";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useEffect, useState } from "react";

type Source = "catalogue" | "upload";

/** One family's Excel/PDF download pair — mirrors the original standalone tool's own
 *  #exportBar: every report family gets its own always-visible download row (not just
 *  whichever tab happens to be active), each disabled with a reason when that family has no
 *  matching rows in this sale. */
function FamilyExportRow({ report, onError }: { report: AuctionReport; onError: (msg: string | null) => void }) {
  const [exportingExcel, setExportingExcel] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const empty = report.stats.total === 0;

  const runExcel = async () => {
    setExportingExcel(true);
    onError(null);
    try {
      await exportCombinedReportExcel(report);
    } catch (e) {
      onError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingExcel(false);
    }
  };

  const runPdf = async () => {
    setExportingPdf(true);
    onError(null);
    try {
      await exportCombinedReportPdf(report);
    } catch (e) {
      onError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 rounded-[var(--radius-lg)] border border-border"
      style={{ background: "var(--surface)", opacity: empty ? 0.55 : 1 }}
    >
      <span className="text-[12px] font-medium text-text-strong flex-1 min-w-0 truncate">{report.title}</span>
      {empty ? (
        <span className="text-[11px] text-text-muted italic shrink-0">No matching rows</span>
      ) : (
        <>
          <Tooltip title={`Export ${report.title} to Excel`}>
            <span>
              <IconButton size="small" onClick={runExcel} disabled={exportingExcel} aria-label={`Export ${report.title} to Excel`}>
                <DownloadOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title={`Export ${report.title} to PDF`}>
            <span>
              <IconButton size="small" onClick={runPdf} disabled={exportingPdf} aria-label={`Export ${report.title} to PDF`}>
                <PictureAsPdfOutlinedIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </>
      )}
    </div>
  );
}

export default function CombinedReportPage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  const [source, setSource] = useState<Source>("catalogue");
  const [combined, setCombined] = useState<CombinedReport | null>(null);
  const [activeFamily, setActiveFamily] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingAll, setExportingAll] = useState<"excel" | "pdf" | null>(null);

  // Upload-mode state — mirrors the original tool's single dropzone + mandatory Sale No before export.
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSaleNo, setUploadSaleNo] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (source !== "catalogue") return;
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCombined(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getCombinedReport(activeCatalogueId)
      .then((r) => {
        setCombined(r);
        setActiveFamily(0);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't generate the combined report"))
      .finally(() => setLoading(false));
  }, [source, activeCatalogueId]);

  const changeSource = (next: Source | null) => {
    if (!next || next === source) return;
    setSource(next);
    setCombined(null);
    setError(null);
  };

  const generateFromUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setError(null);
    try {
      const r = await api.getCombinedReportFromUpload(uploadFile, uploadSaleNo.trim() || undefined);
      setCombined(r);
      setActiveFamily(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate the combined report from this file");
    } finally {
      setUploading(false);
    }
  };

  const report = combined?.reports[activeFamily] ?? null;
  const nonEmptyReports = combined?.reports.filter((r) => r.stats.total > 0) ?? [];

  const exportAll = async (kind: "excel" | "pdf") => {
    setExportingAll(kind);
    setError(null);
    try {
      for (const r of nonEmptyReports) {
        // Sequential, not Promise.all — the original tool's own "Export all" awaits one file at
        // a time so a browser's popup/download-count limiter never silently drops one.
        if (kind === "excel") await exportCombinedReportExcel(r);
        else await exportCombinedReportPdf(r);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExportingAll(null);
    }
  };

  return (
    <div>
      {exportingAll && <BusyOverlay message={exportingAll === "excel" ? "Building workbooks…" : "Building PDFs…"} />}
      {uploading && <BusyOverlay message="Reading workbook…" />}
      <PageHeader
        title="Top Price Reports"
        subtitle="Top Prices, CTC, Off Grades & Dust, Low Grown and Premium Flowery — ranked against every broker in the sale."
        backTo={{ href: "/reports", label: "Reports" }}
        actions={
          <div className="flex items-center gap-2 flex-wrap">
            <ToggleButtonGroup size="small" value={source} exclusive onChange={(_, v) => changeSource(v)}>
              <ToggleButton value="catalogue" sx={{ textTransform: "none", fontSize: 12, px: 1.5 }}>
                From catalogue
              </ToggleButton>
              <ToggleButton value="upload" sx={{ textTransform: "none", fontSize: 12, px: 1.5 }}>
                Upload workbook
              </ToggleButton>
            </ToggleButtonGroup>

            {source === "catalogue" && (
              <Select
                size="small"
                value={activeCatalogueId ?? ""}
                onChange={(e) => selectCatalogue(e.target.value || null)}
                displayEmpty
                sx={{ minWidth: 180, fontSize: 13 }}
                renderValue={(v) => {
                  if (!v) return <span className="text-text-muted">No catalogue</span>;
                  const c = catalogues.find((x) => x.id === v);
                  return c?.sourceName ?? "…";
                }}
              >
                {catalogues.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.sourceName}
                  </MenuItem>
                ))}
              </Select>
            )}
          </div>
        }
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger print:hidden">{error}</div>
      )}

      {source === "upload" && (
        <div className="mb-5 p-4 rounded-[var(--radius-lg)] border border-border flex items-end gap-3 flex-wrap print:hidden" style={{ background: "var(--surface)" }}>
          <TextField
            label="Sale No"
            size="small"
            value={uploadSaleNo}
            onChange={(e) => setUploadSaleNo(e.target.value)}
            sx={{ width: 110 }}
            helperText="Required before exporting"
          />
          <Button size="small" variant="outlined" component="label" startIcon={<CloudUploadOutlinedIcon fontSize="small" />}>
            {uploadFile ? uploadFile.name : "Choose master sales sheet"}
            <input
              type="file"
              accept=".xlsx,.xls"
              hidden
              onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
            />
          </Button>
          <Button
            size="small"
            variant="contained"
            onClick={generateFromUpload}
            disabled={!uploadFile || !uploadSaleNo.trim() || uploading}
          >
            {uploading ? "Generating…" : "Generate report"}
          </Button>
        </div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {!loading && source === "catalogue" && !activeCatalogueId && (
        <div className="text-center py-16 text-text-muted">No catalogue loaded — import one from Catalogue Manager first.</div>
      )}

      {!loading && source === "upload" && !combined && !uploading && (
        <div className="text-center py-16 text-text-muted">Choose a sale number and workbook, then Generate report.</div>
      )}

      {!loading && combined && (
        <div>
          <div className="flex flex-wrap gap-2 mb-4 print:hidden">
            {combined.reports.map((r) => (
              <FamilyExportRow key={r.reportKey} report={r} onError={setError} />
            ))}
            <div className="flex items-center gap-2">
              <Button
                size="small"
                variant="text"
                onClick={() => exportAll("excel")}
                disabled={exportingAll !== null || nonEmptyReports.length === 0}
                sx={{ textTransform: "none", fontSize: 12 }}
              >
                Export all (Excel)
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => exportAll("pdf")}
                disabled={exportingAll !== null || nonEmptyReports.length === 0}
                sx={{ textTransform: "none", fontSize: 12 }}
              >
                Export all (PDF)
              </Button>
            </div>
          </div>

          <Tabs
            value={activeFamily}
            onChange={(_, v) => setActiveFamily(v)}
            variant="scrollable"
            scrollButtons="auto"
            className="mb-4 print:hidden"
          >
            {combined.reports.map((r, i) => (
              <Tab key={r.reportKey} value={i} label={r.title} sx={{ textTransform: "none", fontSize: 13 }} />
            ))}
          </Tabs>

          {report && (
            <>
              <div className="border-b border-border pb-4 mb-5">
                <p className="font-mono text-[10px] tracking-widest uppercase text-text-muted m-0 mb-1">Asia Siyaka Commodities</p>
                <h2 className="font-display text-xl font-bold text-text-strong m-0 mb-1">{report.title}</h2>
                <p className="text-[12px] text-text-muted m-0">
                  {combined.sourceName} · Generated {new Date(report.generatedAt).toLocaleString()}
                </p>
              </div>

              <AuctionReportView report={report} />

              <div className="flex items-center gap-2.5 mt-5 flex-wrap print:hidden">
                <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()}>
                  Print
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
