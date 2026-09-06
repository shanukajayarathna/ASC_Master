"use client";

import MarketBulletinBulletin from "@/components/reports/MarketBulletinBulletin";
import { useAuth } from "@/context/AuthContext";
import { api } from "@/lib/api";
import type { MarketBulletin, MonthlyComparison } from "@/types/api";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

/**
 * Chrome-free print target for the server-side PDF export (see
 * api/reports/market-bulletin-pdf/route.ts). Deliberately lives OUTSIDE the (app) route
 * group — no Shell/Topbar/CatalogueProvider, nothing on the page but the bulletin itself —
 * so Chromium's real print pagination has nothing else on the page to reserve blank space
 * for. The old approach (rendering the full app page and hiding everything outside
 * .report-print-area with `visibility: hidden`) produced 2 extra blank PDF pages: hidden
 * elements still occupy their layout height, so the print engine's page-count still counted
 * the header/toolbar/catalogue-selector's space even though nothing painted there.
 *
 * Still wraps its own content in .print-root (globals.css's `@media print { body * {
 * visibility: hidden } }` rule is app-wide, not scoped to any one page — anything under
 * `@media print` without an override renders invisible, confirmed the hard way: the bulletin
 * HTML was present and correct, but every exported page came back visually blank). .print-root
 * is .report-print-area minus its position:absolute — that repositioning is for escaping past
 * hidden chrome on the full app page, which this bare route has none of, and it turned out to
 * actively break Top Price Page's own pagination (see print/top-price-page/page.tsx's doc
 * comment), so it's left out here too even though this report's own pages happened to fit
 * cleanly either way.
 *
 * `data-ready` flips to "true" only once the bulletin AND its page-4 monthly data have both
 * settled (loaded or failed) AND the bulletin has settled on a final density (MarketBulletin
 * Bulletin's own auto-fit ladder — see that file's MB_DENSITY_LADDER) — the exporter waits on it
 * instead of a fixed timeout before calling page.pdf(), so a PDF can never capture a
 * mid-measurement frame or a permanently-missing 4th page.
 */
export default function MarketBulletinPrintPage() {
  return (
    <Suspense fallback={<div data-ready="false" />}>
      <MarketBulletinPrintContent />
    </Suspense>
  );
}

function MarketBulletinPrintContent() {
  const { loading: authLoading } = useAuth();
  const params = useSearchParams();
  const catalogueId = params.get("catalogueId");

  const [bulletin, setBulletin] = useState<MarketBulletin | null>(null);
  const [monthly, setMonthly] = useState<MonthlyComparison | null>(null);
  const [monthlySettled, setMonthlySettled] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [layoutReady, setLayoutReady] = useState(false);

  useEffect(() => {
    if (authLoading || !catalogueId) return;
    api
      .getMarketBulletin(catalogueId)
      .then(setBulletin)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, [authLoading, catalogueId]);

  // Fetched in parallel with the bulletin itself, but the print route waits for this to SETTLE
  // (succeed or fail) before rendering anything at all — unlike the on-screen page, where page 4
  // arriving a moment late just means it pops in shortly after, a PDF export only gets one shot:
  // if page.pdf() fired before this resolved, that export would permanently be missing page 4.
  useEffect(() => {
    if (authLoading || !catalogueId) return;
    api
      .getMarketBulletinMonthly(catalogueId)
      .then((m) => setMonthly(m ?? null))
      .catch(() => setMonthly(null))
      .finally(() => setMonthlySettled(true));
  }, [authLoading, catalogueId]);

  if (error) return <div data-error={error} />;
  if (!bulletin || !monthlySettled) return <div data-ready="false" />;

  return (
    <div className="print-root" data-ready={layoutReady ? "true" : "false"}>
      <MarketBulletinBulletin bulletin={bulletin} monthly={monthly} onReady={() => setLayoutReady(true)} />
    </div>
  );
}
