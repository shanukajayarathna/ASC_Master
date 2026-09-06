"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import MarketBulletinBulletin from "@/components/reports/MarketBulletinBulletin";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api, AUTH_TOKEN_STORAGE_KEY } from "@/lib/api";
import type { MarketBulletin, MonthlyComparison } from "@/types/api";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { useEffect, useState } from "react";

export default function MarketBulletinPage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  const [bulletin, setBulletin] = useState<MarketBulletin | null>(null);
  const [monthly, setMonthly] = useState<MonthlyComparison | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBulletin(null);
    if (!activeCatalogueId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getMarketBulletin(activeCatalogueId)
      .then((b) => {
        if (!cancelled) setBulletin(b);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Couldn't build the Weekly Market Grade Classification/Quotation");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    // A switch to a different sale mid-flight must not let the OLD sale's slower response land
    // after the new one's — confirmed live: picking a 2024 sale right after a 2026 one showed
    // the 2026 fetch resolving second and silently overwriting the correct 2024 state.
    return () => {
      cancelled = true;
    };
  }, [activeCatalogueId]);

  // Page 4's own data, specific to the selected sale (unlike the bulletin's grade tables, this
  // isn't global) — fetched alongside but kept as its own request/state so a failure here (or
  // the sale's own name not parsing into a month) degrades to "just 3 pages" rather than
  // blocking the rest of the report. Same stale-response guard as the bulletin fetch above, and
  // for the same reason: reset to null immediately so a lingering page 4 from the PREVIOUS sale
  // never stays on screen (or wins a race) while the new sale's own answer is still in flight.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonthly(null);
    if (!activeCatalogueId) return;
    let cancelled = false;
    api
      .getMarketBulletinMonthly(activeCatalogueId)
      .then((m) => {
        if (!cancelled) setMonthly(m ?? null);
      })
      .catch(() => {
        if (!cancelled) setMonthly(null);
      });
    return () => {
      cancelled = true;
    };
  }, [activeCatalogueId]);

  // Server-side render via a real headless Chromium print (Playwright's page.pdf(), the same
  // engine behind a browser's own "Print > Save as PDF") — see
  // api/reports/market-bulletin-pdf/route.ts's doc comment for why this replaced the earlier
  // client-side html2canvas+jsPDF screenshot approach (it produced genuinely corrupted,
  // clipped-looking rows once captured, despite the live DOM measuring perfectly).
  const exportPdf = async () => {
    if (!bulletin || !activeCatalogueId) return;
    setExportingPdf(true);
    setError(null);
    try {
      const token = window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY);
      const res = await fetch("/api/reports/market-bulletin-pdf", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ catalogueId: activeCatalogueId, sourceName: bulletin.sourceName }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error ?? `Export failed (${res.status})`);
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `weekly-market-grade-classification-quotation-sale-${bulletin.sourceName.match(/\d+/)?.[0] ?? "draft"}.pdf`;
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
      <PageHeader
        title="Weekly Market Grade Classification/Quotation"
        subtitle="Select Best / Best / Below Best / Poor price-tier ranges per grade, this sale vs the immediately preceding one."
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

      {!loading && bulletin && (
        <div className="report-print-area">
          <div className="border-b border-border pb-4 mb-5 flex items-center justify-between flex-wrap gap-3 print:hidden">
            <p className="text-[12.5px] text-text-muted m-0">
              {bulletin.sourceName} vs. {bulletin.previousSourceName ?? "no prior sale found"}
            </p>
            <div className="flex gap-2 flex-wrap">
              <Button variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()}>
                Print
              </Button>
              <Button variant="outlined" startIcon={<PictureAsPdfOutlinedIcon fontSize="small" />} onClick={exportPdf} disabled={exportingPdf}>
                {exportingPdf ? "Rendering…" : "Export PDF"}
              </Button>
            </div>
          </div>

          <MarketBulletinBulletin bulletin={bulletin} monthly={monthly} />
        </div>
      )}
    </div>
  );
}
