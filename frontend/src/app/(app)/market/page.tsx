"use client";

import KpiSection from "@/components/dashboard/KpiSection";
import KpiTile from "@/components/dashboard/KpiTile";
import PageHeader from "@/components/shared/PageHeader";
import { SkeletonCard, SkeletonRows } from "@/components/shared/SkeletonBlock";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { AccuracyBucket, AccuracyOverview, ImportStatus, MarketInsight } from "@/types/api";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const BREAKDOWN_COLUMNS: { value: string; label: string }[] = [
  { value: "broker", label: "Broker" },
  { value: "grade", label: "Grade" },
  { value: "elevation", label: "Elevation" },
];

const HIGH_ERROR_THRESHOLD = 15;

export default function MarketPage() {
  const { activeCatalogueId, activeCatalogue, error: catalogueError } = useCatalogue();

  const [status, setStatus] = useState<ImportStatus | null>(null);
  const [overview, setOverview] = useState<AccuracyOverview | null>(null);
  const [breakdownColumn, setBreakdownColumn] = useState("broker");
  const [breakdown, setBreakdown] = useState<AccuracyBucket[] | null>(null);
  const [insights, setInsights] = useState<MarketInsight[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const loadComparison = (catalogueId: string) => {
    setLoading(true);
    setError(null);
    Promise.all([api.getImportStatus(catalogueId), api.getAccuracyOverview(catalogueId), api.getMarketInsights(catalogueId)])
      .then(([s, o, i]) => {
        setStatus(s);
        setOverview(o);
        setInsights(i);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load market intelligence"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStatus(null);
      setOverview(null);
      setInsights(null);
      return;
    }
    loadComparison(activeCatalogueId);
  }, [activeCatalogueId]);

  useEffect(() => {
    if (!activeCatalogueId || !overview || overview.lotsCompared === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBreakdown(null);
      return;
    }
    api
      .getAccuracyBreakdown(activeCatalogueId, breakdownColumn)
      .then(setBreakdown)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load accuracy breakdown"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCatalogueId, breakdownColumn, overview?.lotsCompared]);

  const handleFile = async (file: File) => {
    if (!activeCatalogueId) return;
    setImporting(true);
    setError(null);
    try {
      await api.importActuals(activeCatalogueId, file);
      loadComparison(activeCatalogueId);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Import failed");
    } finally {
      setImporting(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Market Intelligence"
        subtitle="Import actual post-sale auction prices and compare them against this catalogue's valuations."
        actions={
          activeCatalogueId && (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={<UploadFileOutlinedIcon fontSize="small" />}
                onClick={() => fileInputRef.current?.click()}
                disabled={importing}
              >
                {importing ? "Importing…" : "Import Actual Results"}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) handleFile(f);
                  e.target.value = "";
                }}
              />
            </>
          )
        }
      />

      {catalogueError && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">
          Couldn&apos;t reach the API ({catalogueError}). Is the backend running at{" "}
          <code className="font-mono">{process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058"}</code>?
        </div>
      )}

      {!activeCatalogueId && !catalogueError && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">No catalogue loaded yet</h3>
          <p className="mb-4">Import a lot catalogue before comparing against actual results.</p>
          <Button component={Link} href="/catalogue" variant="contained" color="primary">
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {activeCatalogueId && error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
      )}

      {activeCatalogueId && loading && !status && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonCard key={i} height={70} />
            ))}
          </div>
          <SkeletonRows rows={6} />
        </div>
      )}

      {activeCatalogueId && status && (
        <>
          <p className="text-[12.5px] text-text-muted mb-5 border border-border rounded-lg bg-surface px-3.5 py-2.5">
            {status.hasImport ? (
              <>
                Actuals loaded from your last import ({new Date(status.lastImportedAt!).toLocaleString()}) ·{" "}
                {formatNumber(status.matched)} lots matched, {formatNumber(status.unmatched)} unmatched,{" "}
                {formatNumber(status.ambiguous)} ambiguous
                {status.fileEmbeddedMatched > 0 &&
                  ` · ${formatNumber(status.fileEmbeddedMatched)} more available directly from the sale file if needed`}
              </>
            ) : status.fileEmbeddedMatched > 0 ? (
              <>
                Using {formatNumber(status.fileEmbeddedMatched)} sold lots&apos; results already in this sale file — no
                import needed. You can still import an external actuals file to override or supplement this.
              </>
            ) : (
              "This sale isn't settled yet, and no actual auction results have been imported for this catalogue."
            )}
          </p>

          {overview && overview.lotsCompared > 0 ? (
            <>
              <KpiSection title="Accuracy Overview" subtitle={`${formatNumber(overview.lotsCompared)} lots compared`} compact>
                <KpiTile label="Lots Compared" value={formatNumber(overview.lotsCompared)} accent="liquor" />
                <KpiTile label="Average Accuracy" value={overview.accuracy !== null ? `${overview.accuracy.toFixed(1)}%` : "—"} accent="sage" />
                <KpiTile label="MAPE" value={overview.mape !== null ? `${overview.mape.toFixed(2)}%` : "—"} />
                <KpiTile label="RMSE" value={formatCurrency(overview.rmse)} accent="info" />
                <KpiTile label="Average Error" value={formatCurrency(overview.avgError)} />
                <KpiTile label="Total Gain (undervalued)" value={formatCurrency(overview.totalGain)} accent="sage" />
                <KpiTile label="Total Loss (overvalued)" value={formatCurrency(overview.totalLoss)} />
              </KpiSection>

              <section className="mb-6">
                <div className="flex items-baseline justify-between gap-2.5 mb-2.5 flex-wrap">
                  <div className="flex items-baseline gap-2.5">
                    <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Accuracy By</h4>
                    <span className="text-[11.5px] text-text-muted">Mean absolute % error, lowest first</span>
                  </div>
                  <Select size="small" value={breakdownColumn} onChange={(e) => setBreakdownColumn(e.target.value)} sx={{ minWidth: 160, fontSize: 13 }}>
                    {BREAKDOWN_COLUMNS.map((c) => (
                      <MenuItem key={c.value} value={c.value}>
                        {c.label}
                      </MenuItem>
                    ))}
                  </Select>
                </div>
                <div className="overflow-x-auto border border-border rounded-lg">
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="bg-surface-alt border-b border-border">
                        <th className="text-left px-3.5 py-2 font-medium text-text-muted">{BREAKDOWN_COLUMNS.find((c) => c.value === breakdownColumn)?.label}</th>
                        <th className="text-right px-3.5 py-2 font-medium text-text-muted">Lots</th>
                        <th className="text-right px-3.5 py-2 font-medium text-text-muted">MAPE</th>
                        <th className="text-right px-3.5 py-2 font-medium text-text-muted">Bias</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdown?.map((b) => (
                        <tr key={b.label} className="border-b border-border last:border-0">
                          <td className="px-3.5 py-2">{b.label}</td>
                          <td className="px-3.5 py-2 text-right font-mono">{formatNumber(b.count)}</td>
                          <td className="px-3.5 py-2 text-right font-mono">
                            <span
                              className="inline-flex items-center gap-1 justify-end"
                              style={b.mape > HIGH_ERROR_THRESHOLD ? { color: "var(--danger)" } : undefined}
                            >
                              {b.mape > HIGH_ERROR_THRESHOLD && <WarningAmberOutlinedIcon sx={{ fontSize: 14 }} />}
                              {b.mape.toFixed(1)}%
                            </span>
                          </td>
                          <td className="px-3.5 py-2 text-right font-mono">
                            {b.bias > 0 ? "+" : ""}
                            {b.bias.toFixed(1)}%
                          </td>
                        </tr>
                      ))}
                      {breakdown && breakdown.length === 0 && (
                        <tr>
                          <td colSpan={4} className="px-3.5 py-4 text-center text-text-muted">
                            No matched lots for this column yet.
                          </td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="mb-6">
                <div className="flex items-baseline gap-2.5 mb-2.5">
                  <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Insights</h4>
                  <span className="text-[11.5px] text-text-muted">Consistent over/under-valuation patterns</span>
                </div>
                {insights && insights.length > 0 ? (
                  <div className="flex flex-col gap-2">
                    {insights.map((i, idx) => (
                      <div key={idx} className="border border-border rounded-md bg-surface px-3.5 py-3 text-[12.5px] text-text flex gap-2.5 items-start">
                        <span className="w-1.5 h-1.5 rounded-full bg-brass mt-1.5 shrink-0" />
                        <span>
                          {i.dimension} <strong>{i.key}</strong> lots ({formatNumber(i.count)} matched) are consistently{" "}
                          <strong>{i.direction}</strong> by approximately {formatCurrency(i.magnitude)} per lot.
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-[12.5px] text-text-muted m-0">
                    No strong valuation patterns detected yet — import more matched actuals for sharper insights.
                  </p>
                )}
              </section>
            </>
          ) : (
            <div className="text-center py-16 text-text-muted border border-dashed border-border rounded-lg">
              <p className="m-0 mb-1">No matched lots to compare yet.</p>
              <p className="m-0 text-[12.5px]">Import an actual auction results file to see accuracy and insights.</p>
            </div>
          )}

          <p className="text-[11.5px] text-text-muted mt-2">
            {activeCatalogue?.sourceName} · {activeCatalogue?.rowCount.toLocaleString()} lots
          </p>
        </>
      )}
    </div>
  );
}
