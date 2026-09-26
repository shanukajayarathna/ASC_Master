"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { useLeaveConfirmation } from "@/hooks/useLeaveConfirmation";
import { api, ApiError } from "@/lib/api";
import { changeDisplay, downloadTrendExcel, downloadTrendPdf, trendSourceNote } from "@/lib/categoryAverageTrendExport";
import type { CategoryAverageTrend, TrendCell } from "@/types/api";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import TableChartOutlinedIcon from "@mui/icons-material/TableChartOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import { useEffect, useMemo, useState } from "react";

const GREEN = "#1E7145";
const RED = "#A62F23";
const SALE_NAME = /^Sale (\d+) - (\d+)$/;

const th = "font-semibold text-[11px] uppercase tracking-wide text-white px-3 py-2 whitespace-nowrap";

function ChangeCell({ cell }: { cell: TrendCell }) {
  const d = changeDisplay(cell.change);
  return (
    <td className="px-3 py-1.5 border-t border-border whitespace-nowrap text-left font-semibold" style={{ color: d.color === "green" ? GREEN : d.color === "red" ? RED : undefined }}>
      {d.text}
    </td>
  );
}

function AverageCell({ cell, bold }: { cell: TrendCell; bold?: boolean }) {
  return (
    <td className={`px-3 py-1.5 border-t border-border whitespace-nowrap text-right tabular-nums ${bold ? "font-semibold text-text-strong" : ""}`}>
      {cell.average === null ? "-" : cell.average.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
    </td>
  );
}

export default function CategoryAverageTrendPage() {
  const { catalogues } = useCatalogue();

  // Every sale, newest first (by sale year then sale number, not by import time).
  const sales = useMemo(
    () =>
      catalogues
        .map((c) => ({ id: c.id, name: c.sourceName, year: c.year, no: Number(SALE_NAME.exec(c.sourceName)?.[1] ?? NaN) }))
        .filter((s) => Number.isFinite(s.no))
        .sort((a, b) => b.year - a.year || b.no - a.no),
    [catalogues],
  );

  const [selectedId, setSelectedId] = useState("");
  const [broker, setBroker] = useState("");
  const [data, setData] = useState<CategoryAverageTrend | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"excel" | "pdf" | null>(null);

  useLeaveConfirmation(exporting !== null, "The report is still being prepared. Leaving now will cancel the download — continue?");

  // Open on the newest sale that actually has results, not on an upcoming sale that only has a catalogue.
  useEffect(() => {
    if (selectedId || sales.length === 0) return;
    let cancelled = false;
    api
      .getLatestSaleWithResults()
      .then((latest) => !cancelled && setSelectedId(latest.catalogueId))
      .catch(() => !cancelled && setSelectedId(sales[0].id));
    return () => {
      cancelled = true;
    };
  }, [sales, selectedId]);

  useEffect(() => {
    if (!selectedId) return;
    let cancelled = false;
    // Discard the previous sale's figures straight away so they never linger while the new ones load.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setLoading(true);
    setError(null);
    api
      .getCategoryAverageTrend(selectedId, broker || undefined)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Couldn't build this report"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [selectedId, broker]);

  const download = async (kind: "excel" | "pdf") => {
    if (!data) return;
    setExporting(kind);
    setError(null);
    try {
      await (kind === "excel" ? downloadTrendExcel(data) : downloadTrendPdf(data));
    } catch (e) {
      setError(e instanceof Error ? e.message : "The download failed");
    } finally {
      setExporting(null);
    }
  };

  const brokerOptions = useMemo(() => {
    const list = data?.availableBrokers ?? [];
    return broker && !list.includes(broker) ? [broker, ...list] : list;
  }, [data, broker]);

  const canDownload = !!data && data.hasResults && !loading && exporting === null;
  const first = data?.sales[0];
  const last = data?.sales[data.sales.length - 1];

  return (
    <div>
      <PageHeader
        title="Category Average Trend"
        subtitle="Average price per grade for Leafy, Semi Leafy, Tippy, Premium Flowery, Off Grade and Dust over the last five sales, with the rise or drop from each sale to the next."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
        <div className="flex items-end gap-3 flex-wrap">
          <TextField select label="Sale" size="small" value={selectedId} onChange={(e) => setSelectedId(e.target.value)} sx={{ minWidth: 190 }} disabled={sales.length === 0}>
            {sales.map((s) => (
              <MenuItem key={s.id} value={s.id}>
                {s.name}
              </MenuItem>
            ))}
          </TextField>
          <TextField select label="Broker" size="small" value={broker} onChange={(e) => setBroker(e.target.value)} sx={{ minWidth: 150 }}>
            <MenuItem value="">All brokers</MenuItem>
            {brokerOptions.map((b) => (
              <MenuItem key={b} value={b}>
                {b}
              </MenuItem>
            ))}
          </TextField>
          <div className="flex gap-2 ml-auto">
            <Button
              variant="outlined"
              size="small"
              startIcon={exporting === "excel" ? <CircularProgress size={14} color="inherit" /> : <TableChartOutlinedIcon fontSize="small" />}
              onClick={() => download("excel")}
              disabled={!canDownload}
            >
              Download Excel
            </Button>
            <Button
              variant="contained"
              size="small"
              startIcon={exporting === "pdf" ? <CircularProgress size={14} color="inherit" /> : <PictureAsPdfOutlinedIcon fontSize="small" />}
              onClick={() => download("pdf")}
              disabled={!canDownload}
            >
              {exporting === "pdf" ? "Preparing PDF…" : "Download PDF"}
            </Button>
          </div>
        </div>
        {first && last && (
          <p className="text-[12px] text-text-muted m-0 mt-3">
            Showing {first.label} to {last.label}
            {data?.baseSale ? ` — ${data.baseSale} is only used to work out the first sale's rise or drop` : ""}. The five sales always end at the sale you pick.
          </p>
        )}
      </div>

      {error && <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>}

      {(loading || (!data && !error && sales.length > 0)) && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {sales.length === 0 && <div className="text-center py-16 text-text-muted">No sales loaded yet — import a sale from Catalogue Manager first.</div>}

      {data && !data.hasResults && (
        <div className="text-center py-12 text-text-muted">
          {data.selectedSale} has no sold results yet{data.broker ? ` for ${data.broker}` : ""}. Pick an earlier sale to see its figures.
        </div>
      )}

      {data && data.hasResults && (
        <>
          <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
            <table className="w-full text-[12.5px] border-collapse min-w-[760px]">
              <thead>
                <tr style={{ background: "#1F3864" }}>
                  <th className={`${th} text-left`}>Grade</th>
                  {data.sales.map((s) => (
                    <th key={s.label} colSpan={2} className={`${th} text-center`}>
                      Sale {s.saleNo}
                      {s.saleYear !== data.sales[data.sales.length - 1].saleYear ? `/${s.saleYear}` : ""}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.categories.map((cat) => (
                  <CategoryRows key={cat.name} cat={cat} />
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[11.5px] text-text-muted mt-3">{trendSourceNote(data)}</p>
        </>
      )}
    </div>
  );
}

function CategoryRows({ cat }: { cat: CategoryAverageTrend["categories"][number] }) {
  return (
    <>
      <tr style={{ background: "#D9E1F2" }}>
        <td className="px-3 py-1.5 border-t border-border font-semibold text-text-strong whitespace-nowrap" style={{ color: "#1F3864" }}>
          {cat.name} <span className="font-normal text-[11px] opacity-70">({cat.lowGrownOnly ? "low grown" : "all elevations"})</span>
        </td>
        {cat.cells.map((cell, i) => (
          <CellPair key={i} cell={cell} bold />
        ))}
      </tr>
      {cat.grades.map((g) => (
        <tr key={g.grade}>
          <td className="pl-6 pr-3 py-1.5 border-t border-border whitespace-nowrap">{g.grade}</td>
          {g.cells.map((cell, i) => (
            <CellPair key={i} cell={cell} />
          ))}
        </tr>
      ))}
    </>
  );
}

function CellPair({ cell, bold }: { cell: TrendCell; bold?: boolean }) {
  return (
    <>
      <AverageCell cell={cell} bold={bold} />
      <ChangeCell cell={cell} />
    </>
  );
}
