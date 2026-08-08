"use client";

import AuctionReportView from "@/components/reports/AuctionReportView";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { CombinedReport } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Tab from "@mui/material/Tab";
import Tabs from "@mui/material/Tabs";
import { useEffect, useState } from "react";

function triggerDownload(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

export default function CombinedReportPage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  const [combined, setCombined] = useState<CombinedReport | null>(null);
  const [activeFamily, setActiveFamily] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
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
  }, [activeCatalogueId]);

  const report = combined?.reports[activeFamily] ?? null;

  const exportExcel = async () => {
    if (!activeCatalogueId || !report) return;
    setExporting(true);
    try {
      const blob = await api.exportAuctionReportExcel(activeCatalogueId, report.reportKey);
      triggerDownload(blob, `${report.title.replace(/\s+/g, "_")}.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Combined Report"
        subtitle="Top Prices, CTC, Off Grades & Dust, Low Grown and Premium Flowery — ranked against every broker in the sale."
        backTo={{ href: "/reports", label: "Reports" }}
        actions={
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

      {!loading && combined && (
        <div>
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
                <p className="text-[12.5px] text-text-muted m-0">
                  {combined.sourceName} · Generated {new Date(report.generatedAt).toLocaleString()}
                </p>
              </div>

              <AuctionReportView report={report} />

              <div className="flex items-center gap-2.5 mt-5 print:hidden">
                <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()}>
                  Print / Save as PDF
                </Button>
                <Button
                  variant="outlined"
                  startIcon={<DownloadOutlinedIcon fontSize="small" />}
                  onClick={exportExcel}
                  disabled={exporting}
                >
                  {exporting ? "Exporting…" : "Export to Excel"}
                </Button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
