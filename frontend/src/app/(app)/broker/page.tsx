"use client";

import BarChart from "@/components/analytics/BarChart";
import { SkeletonCard, SkeletonRows } from "@/components/shared/SkeletonBlock";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { BrokerStats } from "@/types/api";
import PageHeader from "@/components/shared/PageHeader";
import Button from "@mui/material/Button";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function BrokerPage() {
  const { activeCatalogueId, activeCatalogue, error: catalogueError } = useCatalogue();
  const [brokers, setBrokers] = useState<BrokerStats[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBrokers(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getBrokerStats(activeCatalogueId)
      .then(setBrokers)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load broker comparison"))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  return (
    <div>
      <PageHeader
        title="Broker Comparison"
        subtitle="Rankings, market share and average-valuation comparisons across brokers."
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
          <p className="mb-4">Import a lot catalogue to compare brokers.</p>
          <Button component={Link} href="/catalogue" variant="contained" color="primary">
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {activeCatalogueId && error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
      )}

      {activeCatalogueId && loading && !brokers && (
        <div aria-busy="true" className="flex flex-col gap-4">
          <SkeletonRows rows={6} />
          <SkeletonCard height={220} />
          <SkeletonCard height={220} />
        </div>
      )}

      {activeCatalogueId && brokers && (
        <>
          <section className="mb-6">
            <div className="flex items-baseline gap-2.5 mb-2.5">
              <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Ranking</h4>
              <span className="text-[11.5px] text-text-muted">Sorted by average valuation</span>
            </div>
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-surface-alt border-b border-border">
                    <th className="text-left px-3.5 py-2 font-medium text-text-muted">#</th>
                    <th className="text-left px-3.5 py-2 font-medium text-text-muted">Broker</th>
                    <th className="text-right px-3.5 py-2 font-medium text-text-muted">Lots</th>
                    <th className="text-right px-3.5 py-2 font-medium text-text-muted">Market Share</th>
                    <th className="text-right px-3.5 py-2 font-medium text-text-muted">Avg. Valuation</th>
                    <th className="text-right px-3.5 py-2 font-medium text-text-muted">Highest</th>
                    <th className="text-right px-3.5 py-2 font-medium text-text-muted">Lowest</th>
                    <th className="text-left px-3.5 py-2 font-medium text-text-muted">Top Grade</th>
                  </tr>
                </thead>
                <tbody>
                  {brokers.map((b, i) => (
                    <tr key={b.name} className="border-b border-border last:border-0">
                      <td className="px-3.5 py-2 text-text-muted">{i + 1}</td>
                      <td className="px-3.5 py-2 font-semibold text-text-strong">{b.name}</td>
                      <td className="px-3.5 py-2 text-right font-mono">{formatNumber(b.lots)}</td>
                      <td className="px-3.5 py-2 text-right font-mono">{b.share.toFixed(1)}%</td>
                      <td className="px-3.5 py-2 text-right font-mono">{formatCurrency(b.avg)}</td>
                      <td className="px-3.5 py-2 text-right font-mono">{formatCurrency(b.max)}</td>
                      <td className="px-3.5 py-2 text-right font-mono">{formatCurrency(b.min)}</td>
                      <td className="px-3.5 py-2">{b.topGrade}</td>
                    </tr>
                  ))}
                  {brokers.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3.5 py-4 text-center text-text-muted">
                        No brokers found in this catalogue.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          <section className="mb-6">
            <div className="flex items-baseline gap-2.5 mb-2.5">
              <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Market Share</h4>
              <span className="text-[11.5px] text-text-muted">Top 12 brokers by lot count</span>
            </div>
            <div className="border border-border rounded-lg bg-surface p-4">
              {brokers.length > 0 ? (
                <BarChart
                  rows={[...brokers]
                    .sort((a, b) => b.lots - a.lots)
                    .slice(0, 12)
                    .map((b) => ({
                      label: b.name,
                      value: b.lots,
                      displayValue: `${formatNumber(b.lots)} (${b.share.toFixed(1)}%)`,
                      detail: `${b.name}: ${formatNumber(b.lots)} lots · ${b.share.toFixed(1)}% market share`,
                    }))}
                  accentColor="var(--sage)"
                />
              ) : (
                <p className="text-[13px] text-text-muted m-0">No lots yet.</p>
              )}
            </div>
          </section>

          <section className="mb-6">
            <div className="flex items-baseline gap-2.5 mb-2.5">
              <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Average Valuation by Broker</h4>
              <span className="text-[11.5px] text-text-muted">Top 12 by average valuation</span>
            </div>
            <div className="border border-border rounded-lg bg-surface p-4">
              {brokers.some((b) => b.avg !== null) ? (
                <BarChart
                  rows={brokers
                    .filter((b) => b.avg !== null)
                    .slice(0, 12)
                    .map((b) => ({
                      label: b.name,
                      value: b.avg!,
                      displayValue: formatCurrency(b.avg),
                      detail: `${b.name}: ${formatCurrency(b.avg)} average · ${formatNumber(b.valued)} valued lot${b.valued === 1 ? "" : "s"}`,
                    }))}
                />
              ) : (
                <p className="text-[13px] text-text-muted m-0">No valued lots for any broker yet.</p>
              )}
            </div>
          </section>

          <p className="text-[11.5px] text-text-muted mt-2">
            {activeCatalogue?.sourceName} · {activeCatalogue?.rowCount.toLocaleString()} lots
          </p>
        </>
      )}
    </div>
  );
}
