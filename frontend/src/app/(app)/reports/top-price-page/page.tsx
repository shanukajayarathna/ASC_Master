"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { buildRegionEntries, exportTopPricePageExcel, exportTopPricePagePdf, type TppRegionEntry } from "@/lib/topPricePageExport";
import type { CombinedReport } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Button from "@mui/material/Button";
import { useEffect, useMemo, useState } from "react";

function rowCountOf(entry: TppRegionEntry): number {
  return entry.category.grades.reduce((n, g) => n + g.rows.length, 0);
}

export default function TopPricePagePage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  const [combined, setCombined] = useState<CombinedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

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
      .then(setCombined)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't build the Top Price Page"))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  const entries = useMemo(() => (combined ? buildRegionEntries(combined) : []), [combined]);
  const totalRows = useMemo(() => entries.reduce((n, e) => n + rowCountOf(e), 0), [entries]);

  const exportExcel = async () => {
    if (!combined) return;
    setExporting(true);
    setError(null);
    try {
      await exportTopPricePageExcel(combined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  const exportPdf = async () => {
    if (!combined) return;
    setExportingPdf(true);
    setError(null);
    try {
      await exportTopPricePagePdf(combined);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div>
      {exportingPdf && <BusyOverlay message="Building PDF…" />}
      {exporting && <BusyOverlay message="Building workbook…" />}
      <PageHeader
        title="Top Price Page"
        subtitle="Every ranked region — Low Grown through CTC Teas — combined into one executive bulletin, matching the original's exact Excel and PDF layout."
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

      {error && <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>}

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
          <div className="border-b border-border pb-4 mb-5 flex items-center justify-between flex-wrap gap-3">
            <div>
              <p className="font-mono text-[10px] tracking-widest uppercase text-text-muted m-0 mb-1">Asia Siyaka Commodities</p>
              <h2 className="font-display text-xl font-bold text-text-strong m-0 mb-1">Top Price Page</h2>
              <p className="text-[12.5px] text-text-muted m-0">
                {combined.sourceName} · {entries.length} region(s) · {totalRows} ranked row(s)
              </p>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon fontSize="small" />} onClick={exportPdf} disabled={exportingPdf}>
                {exportingPdf ? "Exporting…" : "Export PDF"}
              </Button>
              <Button variant="outlined" startIcon={<DownloadOutlinedIcon fontSize="small" />} onClick={exportExcel} disabled={exporting}>
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            </div>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {entries.map((entry) => {
              const rows = rowCountOf(entry);
              return (
                <div key={entry.title} className="border border-border rounded-lg bg-surface p-4" style={{ borderColor: rows ? "var(--brass)" : "var(--border)" }}>
                  <div className="text-[11px] font-medium text-text-muted">{entry.title}</div>
                  <div className="font-display text-2xl font-bold text-text-strong">{rows}</div>
                  <div className="text-[11px] text-text-muted">
                    ranked row{rows === 1 ? "" : "s"} across {entry.category.grades.length} grade group{entry.category.grades.length === 1 ? "" : "s"}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
