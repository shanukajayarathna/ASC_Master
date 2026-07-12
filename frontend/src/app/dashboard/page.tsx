"use client";

import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { DashboardStats } from "@/types/api";
import Button from "@mui/material/Button";
import { useEffect, useState } from "react";
import Link from "next/link";
import KpiSection from "@/components/dashboard/KpiSection";
import KpiTile from "@/components/dashboard/KpiTile";

export default function DashboardPage() {
  const { activeCatalogueId, activeCatalogue, error: catalogueError } = useCatalogue();
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fetching in response to activeCatalogueId changing (not deriving state from props/state
    // available during render), so this is a data synchronization effect, not the anti-pattern
    // the rule targets — disabled per-line since the setters are unavoidably synchronous here.
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStats(null);
      return;
    }
    setLoading(true);
    setError(null);
    api
      .getDashboardStats(activeCatalogueId)
      .then(setStats)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load dashboard"))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-text-strong m-0 mb-1">Executive Dashboard</h1>
        <p className="text-[13px] text-text-muted m-0 max-w-xl">
          A live overview of catalogue coverage, valuation and composition — powered by PostgreSQL via the ASP.NET Core API.
        </p>
      </div>

      {catalogueError && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">
          Couldn&apos;t reach the API ({catalogueError}). Is the backend running at{" "}
          <code className="font-mono">
            {process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058"}
          </code>
          ?
        </div>
      )}

      {!activeCatalogueId && !catalogueError && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">No catalogue loaded yet</h3>
          <p className="mb-4">Import a lot catalogue to populate the dashboard.</p>
          <Button component={Link} href="/catalogue" variant="contained" color="primary">
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {activeCatalogueId && error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
      )}

      {activeCatalogueId && stats && (
        <>
          <KpiSection title="Coverage & Progress" subtitle="How much of the catalogue is valued">
            <KpiTile label="Total Lots" value={stats.total.toLocaleString()} accent="liquor" />
            <KpiTile label="Pending Valuations" value={stats.pending.toLocaleString()} />
            <KpiTile label="Completed Valuations" value={stats.completed.toLocaleString()} accent="sage" />
            <KpiTile label="Today's Progress" value={`${stats.todayCount.toLocaleString()} tickets`} accent="info" />
          </KpiSection>

          <KpiSection title="Valuation" subtitle="Across all valued lots">
            <KpiTile label="Average Valuation" value={formatCurrency(stats.avgValuation)} accent="info" />
            <KpiTile label="Highest Valuation" value={formatCurrency(stats.maxValuation)} />
            <KpiTile label="Lowest Valuation" value={formatCurrency(stats.minValuation)} />
            <KpiTile label="Average Range Width" value={formatCurrency(stats.avgRangeWidth)} />
          </KpiSection>

          <KpiSection title="Portfolio Composition">
            <KpiTile label="Most Active Broker" value={stats.mostActiveBroker ?? "—"} />
            <KpiTile label="Most Common Grade" value={stats.mostCommonGrade ?? "—"} />
            <KpiTile label="Most Common Category" value={stats.mostCommonCategory ?? "—"} />
            <KpiTile label="Most Common Elevation" value={stats.mostCommonElevation ?? "—"} />
          </KpiSection>

          <KpiSection title="Weight & Volume" compact>
            <KpiTile label="Total Net Weight" value={stats.totalNetWeight ? `${formatNumber(stats.totalNetWeight)} kg` : "—"} />
            <KpiTile label="Total Gross Weight" value={stats.totalGrossWeight ? `${formatNumber(stats.totalGrossWeight)} kg` : "—"} />
            <KpiTile label="Average Net Weight" value={stats.avgNetWeight ? `${formatNumber(stats.avgNetWeight, 1)} kg` : "—"} />
            <KpiTile label="Average Gross Weight" value={stats.avgGrossWeight ? `${formatNumber(stats.avgGrossWeight, 1)} kg` : "—"} />
          </KpiSection>

          <p className="text-[11.5px] text-text-muted mt-2">
            Source: {activeCatalogue?.sourceName} · {activeCatalogue?.rowCount.toLocaleString()} lots ·{" "}
            {activeCatalogue?.headers.length} columns
          </p>
        </>
      )}

      {activeCatalogueId && loading && !stats && <p className="text-text-muted text-sm">Loading dashboard…</p>}
    </div>
  );
}
