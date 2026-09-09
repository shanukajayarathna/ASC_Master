"use client";

import TopPriceBulletin from "@/components/reports/TopPriceBulletin";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import { buildTppMeta, planTppBulletinAutoFit, type TppBulletinPage, type TppDensity, type TppMeta } from "@/lib/topPricePageExport";
import type { CatalogueDetail, CombinedReport } from "@/types/api";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useState } from "react";

/**
 * Chrome-free print target for the server-side PDF export (see
 * api/reports/top-price-page-pdf/route.ts) — same pattern as
 * print/market-bulletin/page.tsx, see that file's doc comment for why: no Shell/Topbar/
 * PageHeader/catalogue-selector on the page at all, so the print engine's pagination has
 * nothing else to reserve blank space for, and the content is wrapped in .print-root so
 * globals.css's app-wide `@media print { body * { visibility: hidden } }` rule doesn't hide
 * it (that rule applies to every page, not just ones that already account for it). .print-root
 * is .report-print-area minus its position:absolute — this report's own `.page` divs are
 * taller than one physical sheet by design (TppDensity's own min-height safety valve), and an
 * absolutely-positioned ancestor doesn't reliably paginate overflowing content across multiple
 * physical PDF pages the way normal in-flow content does (confirmed: it came out as 4 pages
 * with 2 mostly-blank, not the intended 2). Staying in normal flow avoids that entirely.
 */
export default function TopPricePagePrintPage() {
  return (
    <Suspense fallback={<div data-ready="false" />}>
      <TopPricePagePrintContent />
    </Suspense>
  );
}

function TopPricePagePrintContent() {
  const { loading: authLoading } = useAuth();
  const params = useSearchParams();
  const catalogueId = params.get("catalogueId");

  const [combined, setCombined] = useState<CombinedReport | null>(null);
  const [catalogue, setCatalogue] = useState<CatalogueDetail | null>(null);
  const [catalogueLoaded, setCatalogueLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (authLoading || !catalogueId) return;
    api
      .getCombinedReport(catalogueId)
      .then(setCombined)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
    // Best-effort: the real sale date(s) (saleDateStart/saleDateEnd) live on the catalogue, not
    // the combined report (CombinedReportDto's own GeneratedAt is when this report was BUILT,
    // not the actual sale date — meta.saleDate used to fall back to `combined.sourceName`, e.g.
    // literally showing "Sale 35 - 2026" as a stand-in for a date). `catalogueLoaded` still flips
    // to true on failure so a catalogue-fetch error doesn't block the export forever —
    // buildTppMeta's own fallback (sourceName) covers that rare case.
    api
      .getCatalogue(catalogueId)
      .then(setCatalogue)
      .finally(() => setCatalogueLoaded(true));
  }, [authLoading, catalogueId]);

  const layout: { pages: TppBulletinPage[]; density: TppDensity } | null = useMemo(
    () => (combined ? planTppBulletinAutoFit(combined) : null),
    [combined]
  );
  const meta: TppMeta | null = useMemo(
    () => (combined ? buildTppMeta(combined, undefined, catalogue?.saleDateStart, catalogue?.saleDateEnd) : null),
    [combined, catalogue]
  );

  if (error) return <div data-error={error} />;
  if (!combined || !layout || !meta || !catalogueLoaded) return <div data-ready="false" />;

  return (
    <div className="print-root" data-ready="true">
      <TopPriceBulletin pages={layout.pages} density={layout.density} meta={meta} />
    </div>
  );
}
