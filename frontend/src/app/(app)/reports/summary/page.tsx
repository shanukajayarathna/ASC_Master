"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { Report } from "@/types/api";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import SlideshowOutlinedIcon from "@mui/icons-material/SlideshowOutlined";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

const REPORT_TYPES: { value: string; label: string }[] = [
  { value: "executive", label: "Executive Summary" },
  { value: "broker", label: "Broker Summary" },
  { value: "grade", label: "Grade Summary" },
  { value: "category", label: "Category Summary" },
  { value: "garden", label: "Garden Summary" },
  { value: "classification", label: "Classification Report" },
  { value: "valuation", label: "Valuation Analysis" },
];

function kpiValue(value: number | null, format: string): string {
  if (value === null) return "—";
  if (format === "currency") return formatCurrency(value);
  if (format === "count") return formatNumber(value);
  return String(value);
}

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function ReportsPage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();
  const searchParams = useSearchParams();

  const [type, setType] = useState(() => searchParams.get("type") ?? "executive");
  const [report, setReport] = useState<Report | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<"excel" | "pptx" | "save" | null>(null);
  const [saved, setSaved] = useState(false);

  // A "Reopen" link from Saved Reports carries ?catalogueId=; apply it once on load.
  useEffect(() => {
    const cid = searchParams.get("catalogueId");
    if (cid && cid !== activeCatalogueId) selectCatalogue(cid);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setReport(null);
      return;
    }
    setLoading(true);
    setError(null);
    setSaved(false);
    api
      .generateReport(activeCatalogueId, type)
      .then(setReport)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't generate the report"))
      .finally(() => setLoading(false));
  }, [activeCatalogueId, type]);

  const exportExcel = async () => {
    if (!activeCatalogueId || !report) return;
    setBusy("excel");
    try {
      const blob = await api.exportReportExcel(activeCatalogueId, type);
      triggerDownload(blob, `${report.title.replace(/\s+/g, "_")}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const exportPptx = async () => {
    if (!activeCatalogueId || !report) return;
    setBusy("pptx");
    try {
      const blob = await api.exportReportPptx(activeCatalogueId, type);
      triggerDownload(blob, `${report.title.replace(/\s+/g, "_")}.pptx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!activeCatalogueId || !report) return;
    setBusy("save");
    try {
      await api.saveReport(type, report.title, activeCatalogueId, report.sourceName);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't save the report");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Executive & Summary Reports"
        subtitle="Generate a summary report for a catalogue."
        backTo={{ href: "/reports", label: "Reports" }}
        actions={
          <>
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
            <Select size="small" value={type} onChange={(e) => setType(e.target.value)} sx={{ minWidth: 190, fontSize: 13 }}>
              {REPORT_TYPES.map((t) => (
                <MenuItem key={t.value} value={t.value}>
                  {t.label}
                </MenuItem>
              ))}
            </Select>
          </>
        }
      />

      {error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark print:hidden">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {!loading && !activeCatalogueId && (
        <div className="text-center py-16 text-text-muted">No catalogue loaded — import one from Catalogue Manager first.</div>
      )}

      {!loading && report && (
        <div className="report-print-area">
          <div className="border-b border-border pb-4 mb-5">
            <p className="font-mono text-[10px] tracking-widest uppercase text-text-muted m-0 mb-1">Asia Siyaka Commodities</p>
            <h2 className="font-display text-xl font-bold text-text-strong m-0 mb-1">{report.title}</h2>
            <p className="text-[12.5px] text-text-muted m-0">
              {report.subtitle} · {report.sourceName} · Generated {new Date(report.generatedAt).toLocaleString()}
            </p>
          </div>

          {report.sections.map((section, i) => (
            <div key={i} className="mb-6">
              <h3 className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-2.5">{section.title}</h3>

              {section.kpis && (
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                  {section.kpis.map((kpi) => (
                    <div key={kpi.label} className="border border-border rounded-lg bg-surface p-3.5">
                      <div className="font-display text-xl font-bold text-text-strong">{kpiValue(kpi.value, kpi.format)}</div>
                      <div className="text-[11.5px] text-text-muted">{kpi.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {section.groups && (
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-surface-alt border-b border-border">
                        <th className="text-left px-3.5 py-2 font-medium text-text-muted">{section.groupUnitLabel ?? "Label"}</th>
                        <th className="text-right px-3.5 py-2 font-medium text-text-muted">Lots</th>
                        {section.groups.some((g) => g.averageValue !== null) && (
                          <th className="text-right px-3.5 py-2 font-medium text-text-muted">Average Valuation</th>
                        )}
                        {section.groups.some((g) => g.percent !== null) && (
                          <th className="text-right px-3.5 py-2 font-medium text-text-muted">% of Total</th>
                        )}
                      </tr>
                    </thead>
                    <tbody>
                      {section.groups.map((g) => (
                        <tr key={g.label} className="border-b border-border last:border-0">
                          <td className="px-3.5 py-2">{g.label}</td>
                          <td className="px-3.5 py-2 text-right font-mono">{formatNumber(g.count)}</td>
                          {section.groups!.some((x) => x.averageValue !== null) && (
                            <td className="px-3.5 py-2 text-right font-mono">
                              {g.averageValue !== null ? formatCurrency(g.averageValue) : "—"}
                            </td>
                          )}
                          {section.groups!.some((x) => x.percent !== null) && (
                            <td className="px-3.5 py-2 text-right font-mono">
                              {g.percent !== null ? `${g.percent.toFixed(1)}%` : "—"}
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}

          <div className="flex items-center gap-2.5 print:hidden">
            <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()}>
              Print / Save as PDF
            </Button>
            <Button
              variant="outlined"
              startIcon={<DownloadOutlinedIcon fontSize="small" />}
              onClick={exportExcel}
              disabled={busy === "excel"}
            >
              {busy === "excel" ? "Exporting…" : "Export to Excel"}
            </Button>
            <Button
              variant="outlined"
              startIcon={<SlideshowOutlinedIcon fontSize="small" />}
              onClick={exportPptx}
              disabled={busy === "pptx"}
            >
              {busy === "pptx" ? "Exporting…" : "Download PPTX"}
            </Button>
            <Button
              variant="outlined"
              startIcon={<BookmarkAddOutlinedIcon fontSize="small" />}
              onClick={save}
              disabled={busy === "save" || saved}
            >
              {saved ? "Saved" : busy === "save" ? "Saving…" : "Save"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
