"use client";

import BusyOverlay from "@/components/shared/BusyOverlay";
import MarketBulletinBulletin from "@/components/reports/MarketBulletinBulletin";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { exportMarketBulletinPdf } from "@/lib/marketBulletinExport";
import type { MarketBulletin } from "@/types/api";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { useEffect, useRef, useState } from "react";

export default function MarketBulletinPage() {
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  const [bulletin, setBulletin] = useState<MarketBulletin | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);

  const pageRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBulletin(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getMarketBulletin(activeCatalogueId)
      .then(setBulletin)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't build the Weekly Market Bulletin"))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  const exportPdf = async () => {
    if (!bulletin) return;
    setExportingPdf(true);
    setError(null);
    try {
      const elements = pageRefs.current.filter((el): el is HTMLDivElement => el !== null);
      await exportMarketBulletinPdf(elements, bulletin.sourceName);
    } catch (e) {
      setError(e instanceof Error ? e.message : "PDF export failed");
    } finally {
      setExportingPdf(false);
    }
  };

  return (
    <div>
      {exportingPdf && <BusyOverlay message="Capturing pages…" />}
      <PageHeader
        title="Weekly Market Bulletin"
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
                {exportingPdf ? "Exporting…" : "Export PDF"}
              </Button>
            </div>
          </div>

          <MarketBulletinBulletin
            bulletin={bulletin}
            onPageRef={(el, i) => {
              pageRefs.current[i] = el;
            }}
          />
        </div>
      )}
    </div>
  );
}
