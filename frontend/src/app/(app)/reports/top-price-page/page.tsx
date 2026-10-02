"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import SalePicker from "@/components/shared/SalePicker";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import TopPriceBulletin from "@/components/reports/TopPriceBulletin";
import TopPriceSimple from "@/components/reports/TopPriceSimple";
import { useCatalogue } from "@/context/CatalogueContext";
import { useLeaveConfirmation } from "@/hooks/useLeaveConfirmation";
import { api, AUTH_HEADERS } from "@/lib/api";
import {
  buildRegionEntries,
  buildTppMeta,
  exportTopPricePageExcel,
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
import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useEffect, useMemo, useRef, useState } from "react";

export default function TopPricePagePage() {
  const { catalogues, activeCatalogueId } = useCatalogue();

  const [combined, setCombined] = useState<CombinedReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [format, setFormat] = useState<"detailed" | "simple">("detailed");

  useLeaveConfirmation(
    exporting || exportingPdf,
    "The Top Price Page export is still running. Leaving now will cancel it — continue?"
  );

  // Guards against an older sale's slower response landing after a newer sale's — without
  // this, the bulletin/Excel export could show the previous sale while the picker shows the
  // new one, and the PDF export (which posts activeCatalogueId directly) could carry the new
  // sale's id together with the stale report's meta.auctionNumber.
  const latestRequestRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeCatalogueId) {
      latestRequestRef.current = null;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCombined(null);
      return;
    }
    const requestKey = activeCatalogueId;
    latestRequestRef.current = requestKey;
    setLoading(true);
    setError(null);
    api
      .getCombinedReport(activeCatalogueId)
      .then((r) => {
        if (latestRequestRef.current === requestKey) setCombined(r);
      })
      .catch((e) => {
        if (latestRequestRef.current === requestKey) setError(e instanceof Error ? e.message : "Couldn't build the Top Price Page");
      })
      .finally(() => {
        if (latestRequestRef.current === requestKey) setLoading(false);
      });
  }, [activeCatalogueId]);

  const layout: { pages: TppBulletinPage[]; density: TppDensity } | null = useMemo(
    () => (combined ? planTppBulletinAutoFit(combined) : null),
    [combined]
  );
  const simpleEntries = useMemo(() => (combined ? buildRegionEntries(combined) : null), [combined]);
  const activeCatalogue = useMemo(() => catalogues.find((c) => c.id === activeCatalogueId) ?? null, [catalogues, activeCatalogueId]);
  const meta: TppMeta | null = useMemo(
    () => (combined ? buildTppMeta(combined, undefined, activeCatalogue?.saleDateStart, activeCatalogue?.saleDateEnd) : null),
    [combined, activeCatalogue]
  );
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
      await exportTopPricePageExcel(combined, undefined, activeCatalogue?.saleDateStart, activeCatalogue?.saleDateEnd);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export failed");
    } finally {
      setExporting(false);
    }
  };

  // Server-side render via a real headless Chromium print (Playwright's page.pdf()) — see
  // api/reports/top-price-page-pdf/route.ts's doc comment for why this replaced the earlier
  // client-side html2canvas+jsPDF screenshot approach.
  const exportPdf = async () => {
    if (!combined || !meta || !activeCatalogueId) return;
    setExportingPdf(true);
    setError(null);
    try {
      const res = await fetch("/api/reports/top-price-page-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...AUTH_HEADERS,
        },
        body: JSON.stringify({ catalogueId: activeCatalogueId, auctionNumber: meta.auctionNumber, format }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `top-price-page${format === "simple" ? "-simple" : ""}-sale-${meta.auctionNumber || "draft"}.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div>
      {exportingPdf && <BusyOverlay message="Rendering PDF…" />}
      {exporting && <BusyOverlay message="Building workbook…" />}
      <PageHeader
        title="Top Price Page"
        subtitle="Every ranked region — Low Grown through CTC Teas — in two formats: a detailed bulletin (up to 2 pages) or a simple one-page sheet. Preview, print or download either."
        backTo={{ href: "/reports", label: "Reports" }}
        actions={
          <SalePicker />
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
              {format === "simple" ? (
                <>
                  {combined.sourceName} · 1 page · simple format · {totalRows} ranked row{totalRows === 1 ? "" : "s"}
                </>
              ) : (
                <>
                  {combined.sourceName} · {layout.pages.length} page{layout.pages.length === 1 ? "" : "s"} at {layout.density.name} density ·{" "}
                  {totalRows} ranked row{totalRows === 1 ? "" : "s"}
                </>
              )}
            </p>
            <div className="flex gap-2 flex-wrap items-center">
              <ToggleButtonGroup
                size="small"
                exclusive
                value={format}
                onChange={(_, v) => v && setFormat(v)}
                aria-label="Top Price Page format"
              >
                <ToggleButton value="detailed">Detailed</ToggleButton>
                <ToggleButton value="simple">Simple</ToggleButton>
              </ToggleButtonGroup>
              <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon fontSize="small" />} onClick={exportPdf} disabled={exportingPdf}>
                {exportingPdf ? "Exporting…" : "Export PDF"}
              </Button>
              {format === "detailed" && (
                <Button variant="outlined" startIcon={<DownloadOutlinedIcon fontSize="small" />} onClick={exportExcel} disabled={exporting}>
                  {exporting ? "Exporting…" : "Export to Excel"}
                </Button>
              )}
            </div>
          </div>

          {format === "simple" && simpleEntries ? (
            <TopPriceSimple entries={simpleEntries} meta={meta} />
          ) : (
            <TopPriceBulletin pages={layout.pages} density={layout.density} meta={meta} />
          )}
        </div>
      )}
    </div>
  );
}
