"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import TopPriceBulletin from "@/components/reports/TopPriceBulletin";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import {
  buildTppMeta,
  exportTopPricePageExcel,
  exportTopPricePagePdf,
  planTppBulletinAutoFit,
  type TppBulletinPage,
  type TppDensity,
  type TppMeta,
  type TppRegionEntry,
} from "@/lib/topPricePageExport";
import type { CombinedReport } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Button from "@mui/material/Button";
import { useEffect, useMemo, useRef, useState } from "react";

export default function TopPricePagePage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  const [combined, setCombined] = useState<CombinedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

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

  const layout: { pages: TppBulletinPage[]; density: TppDensity } | null = useMemo(
    () => (combined ? planTppBulletinAutoFit(combined) : null),
    [combined]
  );
  const meta: TppMeta | null = useMemo(() => (combined ? buildTppMeta(combined) : null), [combined]);
  const totalRows = useMemo(() => {
    if (!layout) return 0;
    const rowsOf = (entry: TppRegionEntry) => entry.category.grades.reduce((j, g) => j + g.rows.length, 0);
    return layout.pages.reduce((n, p) => n + p.sections.reduce((m, s) => m + rowsOf(s.entry), 0), 0);
  }, [layout]);

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
    if (!combined || !meta) return;
    setExportingPdf(true);
    setError(null);
    try {
      const elements = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
      await exportTopPricePagePdf(elements, meta);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div>
      {exportingPdf && <BusyOverlay message="Capturing pages…" />}
      {exporting && <BusyOverlay message="Building workbook…" />}
      <PageHeader
        title="Top Price Page"
        subtitle="Every ranked region — Low Grown through CTC Teas — combined into one executive bulletin, auto-densified to always fit within 2 pages."
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
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger print:hidden">{error}</div>
      )}

      {loading && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {!loading && !activeCatalogueId && (
        <div className="text-center py-16 text-text-muted">No catalogue loaded — import one from Catalogue Manager first.</div>
      )}

      {!loading && combined && layout && meta && (
        // report-print-area (globals.css) is the same "print only this element" scoping every
        // other report page uses for its own Print button — this page never had it, so
        // window.print() here was rendering blank (the global @media print rule hides
        // `body *` by default and only un-hides content inside a `.report-print-area`).
        <div className="report-print-area">
          <div className="border-b border-border pb-4 mb-5 flex items-center justify-between flex-wrap gap-3 print:hidden">
            <p className="text-[12.5px] text-text-muted m-0">
              {combined.sourceName} · {layout.pages.length} page{layout.pages.length === 1 ? "" : "s"} at {layout.density.name} density ·{" "}
              {totalRows} ranked row{totalRows === 1 ? "" : "s"}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon fontSize="small" />} onClick={exportPdf} disabled={exportingPdf}>
                {exportingPdf ? "Exporting…" : "Export PDF"}
              </Button>
              <Button variant="outlined" startIcon={<DownloadOutlinedIcon fontSize="small" />} onClick={exportExcel} disabled={exporting}>
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            </div>
          </div>

          <TopPriceBulletin
            pages={layout.pages}
            density={layout.density}
            meta={meta}
            onPageRef={(el, i) => {
              pageRefs.current[i] = el;
            }}
          />
        </div>
      )}
    </div>
  );
}
