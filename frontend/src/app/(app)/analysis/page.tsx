"use client";

import FloatingAnalyticsChat from "@/components/analytics/FloatingAnalyticsChat";
import BarChart from "@/components/analytics/BarChart";
import FilterPanel from "@/components/analytics/FilterPanel";
import MarketAnalytics from "@/components/analytics/MarketAnalytics";
import ReportsLauncher from "@/components/analytics/ReportsLauncher";
import KpiSection from "@/components/dashboard/KpiSection";
import KpiTile from "@/components/dashboard/KpiTile";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { CLASSIFICATION_COLOR, CLASSIFICATION_LABEL } from "@/lib/classificationBadge";
import { formatCurrency, formatNumber } from "@/lib/format";
import type { DataQuality, FilteredAnalytics, MslAnalyticsFilter, MslFilterOptions, OverviewStats, ReportGroupRow, TopBottomLot } from "@/types/api";
import PageHeader from "@/components/shared/PageHeader";
import { SkeletonCard, SkeletonRows } from "@/components/shared/SkeletonBlock";
import TeaLoader from "@/components/shared/TeaLoader";
import Button from "@mui/material/Button";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

const BREAKDOWN_COLUMNS: { value: string; label: string; reportType?: string }[] = [
  { value: "broker", label: "Broker", reportType: "broker" },
  { value: "grade", label: "Grade", reportType: "grade" },
  { value: "category", label: "Category", reportType: "category" },
  { value: "garden", label: "Garden", reportType: "garden" },
  { value: "elevation", label: "Elevation" },
  { value: "region", label: "Region" },
  { value: "warehouse", label: "Warehouse" },
  { value: "saleNo", label: "Sale No" },
];

// Reverse-keyed off the label the backend actually sends ("Select Best", "Below Best", …),
// same source as CatalogueGrid/LotViewDialog so this chart never drifts from those badges.
const DISTRIBUTION_COLOR: Record<string, { bg: string; fg: string }> = Object.fromEntries(
  Object.keys(CLASSIFICATION_COLOR).map((key) => [CLASSIFICATION_LABEL[key], CLASSIFICATION_COLOR[key]])
);
const DISTRIBUTION_LEGEND = Object.keys(CLASSIFICATION_COLOR).map((key) => ({
  label: CLASSIFICATION_LABEL[key],
  color: CLASSIFICATION_COLOR[key].fg,
}));

/** The original valuation-centric analysis of the active catalogue — now the "Valuations"
 *  view inside the tabbed Analysis page (market pre/post-auction views live alongside). */
function ValuationAnalysis() {
  const { activeCatalogueId, activeCatalogue, error: catalogueError } = useCatalogue();

  const [overview, setOverview] = useState<OverviewStats | null>(null);
  const [quality, setQuality] = useState<DataQuality | null>(null);
  const [distribution, setDistribution] = useState<ReportGroupRow[] | null>(null);
  const [breakdownColumn, setBreakdownColumn] = useState("broker");
  const [breakdown, setBreakdown] = useState<ReportGroupRow[] | null>(null);
  const [topBottomMode, setTopBottomMode] = useState<"top" | "bottom">("top");
  const [topBottomN, setTopBottomN] = useState(15);
  const [topBottom, setTopBottom] = useState<TopBottomLot[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOverview(null);
      setQuality(null);
      setDistribution(null);
      return;
    }
    setLoading(true);
    setError(null);
    Promise.all([
      api.getOverviewStats(activeCatalogueId),
      api.getDataQuality(activeCatalogueId),
      api.getDistribution(activeCatalogueId),
    ])
      .then(([o, q, d]) => {
        setOverview(o);
        setQuality(q);
        setDistribution(d);
      })
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load analysis"))
      .finally(() => setLoading(false));
  }, [activeCatalogueId]);

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBreakdown(null);
      return;
    }
    api
      .getBreakdown(activeCatalogueId, breakdownColumn)
      .then(setBreakdown)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load breakdown"));
  }, [activeCatalogueId, breakdownColumn]);

  useEffect(() => {
    if (!activeCatalogueId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTopBottom(null);
      return;
    }
    api
      .getTopBottomLots(activeCatalogueId, topBottomMode, topBottomN)
      .then(setTopBottom)
      .catch((e) => setError(e instanceof Error ? e.message : "Failed to load top/bottom lots"));
  }, [activeCatalogueId, topBottomMode, topBottomN]);

  const breakdownMeta = useMemo(() => BREAKDOWN_COLUMNS.find((c) => c.value === breakdownColumn), [breakdownColumn]);

  return (
    <div>
      {catalogueError && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">
          Couldn&apos;t reach the API ({catalogueError}). Is the backend running at{" "}
          <code className="font-mono">{process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058"}</code>?
        </div>
      )}

      {!activeCatalogueId && !catalogueError && (
        <div className="text-center py-16 text-text-muted">
          <h3 className="font-display text-xl text-text mb-1">No catalogue loaded yet</h3>
          <p className="mb-4">Import a lot catalogue to run the analysis.</p>
          <Button component={Link} href="/catalogue" variant="contained" color="primary">
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {activeCatalogueId && error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
      )}

      {activeCatalogueId && loading && !overview && (
        <div aria-busy="true" className="relative flex flex-col gap-4">
          <div className="absolute inset-0 z-10 flex flex-col items-center pt-24 gap-3"
            style={{ backdropFilter: "blur(3px)", WebkitBackdropFilter: "blur(3px)", background: "color-mix(in srgb, var(--paper-0) 35%, transparent)" }}>
            <TeaLoader size={64} />
            <span className="text-[13px] font-medium text-text-strong">Brewing the valuation analysis…</span>
          </div>
          <div className="grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
            {Array.from({ length: 8 }).map((_, i) => (
              <SkeletonCard key={i} height={70} />
            ))}
          </div>
          <SkeletonCard height={200} />
          <SkeletonRows rows={6} />
        </div>
      )}

      {activeCatalogueId && overview && (
        <>
          <KpiSection title="Overview" subtitle="Across all valued lots" compact>
            <KpiTile label="Mean" value={formatCurrency(overview.mean)} accent="liquor" />
            <KpiTile label="Median" value={formatCurrency(overview.median)} />
            <KpiTile label="Mode" value={formatCurrency(overview.mode)} />
            <KpiTile label="Std. Deviation" value={formatCurrency(overview.stdDev)} accent="info" />
            <KpiTile label="Variance" value={formatCurrency(overview.variance)} />
            <KpiTile label="Q1" value={formatCurrency(overview.q1)} />
            <KpiTile label="Q3" value={formatCurrency(overview.q3)} />
            <KpiTile label="Spread (IQR)" value={formatCurrency(overview.spread)} accent="sage" />
          </KpiSection>

          <section className="mb-6">
            <div className="flex items-baseline justify-between gap-2.5 mb-2.5 flex-wrap">
              <div className="flex items-baseline gap-2.5">
                <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Group Breakdown</h4>
                <span className="text-[11.5px] text-text-muted">Average valuation by {breakdownMeta?.label.toLowerCase()}</span>
              </div>
              <div className="flex items-center gap-2">
                {breakdownMeta?.reportType && (
                  <Button component={Link} href={`/reports?type=${breakdownMeta.reportType}`} size="small">
                    View as table
                  </Button>
                )}
                <Select size="small" value={breakdownColumn} onChange={(e) => setBreakdownColumn(e.target.value)} sx={{ minWidth: 160, fontSize: 13 }}>
                  {BREAKDOWN_COLUMNS.map((c) => (
                    <MenuItem key={c.value} value={c.value}>
                      {c.label}
                    </MenuItem>
                  ))}
                </Select>
              </div>
            </div>
            <div className="border border-border rounded-lg bg-surface p-4">
              {breakdown && breakdown.length > 0 ? (
                <BarChart
                  rows={breakdown.map((g) => ({
                    label: g.label,
                    value: g.averageValue ?? 0,
                    displayValue: formatCurrency(g.averageValue),
                    detail: `${g.label}: ${formatCurrency(g.averageValue)} average · ${formatNumber(g.count)} lot${g.count === 1 ? "" : "s"}`,
                  }))}
                />
              ) : (
                <p className="text-[13px] text-text-muted m-0">No valued lots for this column yet.</p>
              )}
            </div>
          </section>

          <section className="mb-6">
            <div className="flex items-baseline gap-2.5 mb-2.5">
              <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Classification Distribution</h4>
              <span className="text-[11.5px] text-text-muted">Lot count by classification tier</span>
            </div>
            <div className="border border-border rounded-lg bg-surface p-4">
              {distribution && distribution.length > 0 ? (
                <BarChart
                  legend={DISTRIBUTION_LEGEND}
                  rows={distribution.map((g) => ({
                    label: g.label,
                    value: g.count,
                    displayValue: formatNumber(g.count),
                    color: DISTRIBUTION_COLOR[g.label]?.fg,
                    detail: `${g.label}: ${formatNumber(g.count)} lot${g.count === 1 ? "" : "s"} (${g.percent?.toFixed(1) ?? "0.0"}%)`,
                  }))}
                />
              ) : (
                <p className="text-[13px] text-text-muted m-0">No lots yet.</p>
              )}
            </div>
          </section>

          <section className="mb-6">
            <div className="flex items-baseline justify-between gap-2.5 mb-2.5 flex-wrap">
              <h4 className="font-display text-[14.5px] font-semibold text-text-strong m-0">Top / Bottom Lots</h4>
              <div className="flex items-center gap-2">
                <ToggleButtonGroup
                  size="small"
                  exclusive
                  value={topBottomMode}
                  onChange={(_, v) => v && setTopBottomMode(v)}
                >
                  <ToggleButton value="top" sx={{ fontSize: 12.5, px: 1.5 }}>
                    Top
                  </ToggleButton>
                  <ToggleButton value="bottom" sx={{ fontSize: 12.5, px: 1.5 }}>
                    Bottom
                  </ToggleButton>
                </ToggleButtonGroup>
                <Select size="small" value={topBottomN} onChange={(e) => setTopBottomN(Number(e.target.value))} sx={{ minWidth: 90, fontSize: 13 }}>
                  {[10, 15, 25, 50].map((n) => (
                    <MenuItem key={n} value={n}>
                      {n} lots
                    </MenuItem>
                  ))}
                </Select>
              </div>
            </div>
            <div className="overflow-x-auto border border-border rounded-lg">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="bg-surface-alt border-b border-border">
                    <th className="text-left px-3.5 py-2 font-medium text-text-muted">Lot</th>
                    <th className="text-left px-3.5 py-2 font-medium text-text-muted">Broker</th>
                    <th className="text-left px-3.5 py-2 font-medium text-text-muted">Grade</th>
                    <th className="text-right px-3.5 py-2 font-medium text-text-muted">Valuation</th>
                  </tr>
                </thead>
                <tbody>
                  {topBottom?.map((lot) => (
                    <tr key={lot.lotId} className="border-b border-border last:border-0">
                      <td className="px-3.5 py-2 font-mono">{lot.lotNumber ?? "—"}</td>
                      <td className="px-3.5 py-2">{lot.broker ?? "—"}</td>
                      <td className="px-3.5 py-2">{lot.grade ?? "—"}</td>
                      <td className="px-3.5 py-2 text-right font-mono">{formatCurrency(lot.effectiveValue)}</td>
                    </tr>
                  ))}
                  {topBottom && topBottom.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-3.5 py-4 text-center text-text-muted">
                        No valued lots yet.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {quality && (
            <KpiSection title="Data Quality" subtitle="Issues worth a second look before the sale">
              <KpiTile label="Missing Valuations" value={formatNumber(quality.missingValuations)} />
              <KpiTile label="Incomplete Records" value={formatNumber(quality.incompleteRecords)} />
              <KpiTile label="Duplicate Lots" value={formatNumber(quality.duplicateLots)} />
              <KpiTile label="Outliers" value={formatNumber(quality.outliers)} accent="info" />
            </KpiSection>
          )}

          <p className="text-[11.5px] text-text-muted mt-2">
            {activeCatalogue?.sourceName} · {activeCatalogue?.rowCount.toLocaleString()} lots
          </p>
        </>
      )}
    </div>
  );
}

/* =====================================================================
   ANALYSIS — tabbed: Post Auction / Pre Auction (MSL archive, replaces
   the external Power BI portal's two report sets) + the original
   Valuations view. Year + sale selectors default to the latest
   (ongoing) sale; the Analytics Agent chatbot is docked beside the
   market views.
   ===================================================================== */

export default function AnalysisPage() {
  const [filterOptions, setFilterOptions] = useState<MslFilterOptions | null>(null);
  const [mode, setMode] = useState<"post" | "pre" | "valuations">("post");
  const [filter, setFilter] = useState<MslAnalyticsFilter>({});
  const [salesError, setSalesError] = useState<string | null>(null);
  const [optionsError, setOptionsError] = useState<string | null>(null);
  const [analytics, setAnalytics] = useState<FilteredAnalytics | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(true);
  const [analyticsError, setAnalyticsError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // One debounced fetch drives everything: the dashboards AND the cascading filter
  // options both come from the same filtered payload. The AbortController doesn't just
  // stop a stale response being applied client-side — the backend threads the same
  // CancellationToken through the whole $facet aggregation, so spam-toggling filters
  // actually cancels the abandoned Mongo query server-side too, not just here.
  useEffect(() => {
    if (!filter.years) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setAnalyticsLoading(true);
    setAnalyticsError(null);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const controller = new AbortController();
    debounceRef.current = setTimeout(() => {
      api
        .mslFilteredAnalytics(filter, controller.signal)
        .then((d) => setAnalytics(d))
        .catch((e) => {
          if (e instanceof DOMException && e.name === "AbortError") return;
          setAnalyticsError(e instanceof Error ? e.message : "Couldn't load analytics");
        })
        .finally(() => {
          if (!controller.signal.aborted) setAnalyticsLoading(false);
        });
    }, 250);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
  }, [filter]);

  useEffect(() => {
    api
      .mslAnalyticsSales()
      .then((s) => {
        // Default to the latest real (non-private) sale — the ongoing one.
        const latest = s.find((x) => x.saleNo > 0) ?? s[0];
        if (latest) setFilter({ years: [latest.year], saleNos: [latest.saleNo] });
      })
      .catch((e) => setSalesError(e instanceof Error ? e.message : "Couldn't load the sales list"));
    api.mslFilterOptions().then(setFilterOptions).catch((e) => setOptionsError(e instanceof Error ? e.message : "Couldn't load filter options"));
  }, []);

  const marketReady = filter.years !== undefined;

  return (
    <div>
      <PageHeader
        title="Analysis"
        subtitle="Pre- and post-auction market analytics from the full MSL archive, plus the valued catalogue's statistics."
      />

      <div className="flex flex-wrap items-center gap-2 mb-4">
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
          <ToggleButton value="post" sx={{ fontSize: 12.5, px: 1.5 }}>Post Auction</ToggleButton>
          <ToggleButton value="pre" sx={{ fontSize: 12.5, px: 1.5 }}>Pre Auction</ToggleButton>
          <ToggleButton value="valuations" sx={{ fontSize: 12.5, px: 1.5 }}>Valuations</ToggleButton>
        </ToggleButtonGroup>
      </div>

      {mode === "valuations" ? (
        <div key="valuations" className="fade-in-soft"><ValuationAnalysis /></div>
      ) : salesError ? (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">
          {salesError} — has the MSL archive been imported?
        </div>
      ) : optionsError && !filterOptions ? (
        <div className="mb-4 p-3 rounded border border-danger bg-danger-light text-[13px] text-liquor-dark flex items-center gap-3">
          Filter panel failed to load ({optionsError}).
          <button
            className="underline font-medium"
            onClick={() => {
              setOptionsError(null);
              api.mslFilterOptions().then(setFilterOptions).catch((e) => setOptionsError(e instanceof Error ? e.message : "Couldn't load filter options"));
            }}
          >
            Retry
          </button>
        </div>
      ) : !marketReady || !filterOptions || !analytics ? (
        /* One unified arrival state: nothing appears piecemeal — the cup holds the whole
           page (filtration panel included) until filters AND data are both ready. */
        <div className="flex flex-col items-center justify-center gap-3 py-28" role="status" aria-live="polite">
          <TeaLoader size={72} />
          <p className="text-[13.5px] font-medium text-text-strong m-0">Brewing your analysis…</p>
          <p className="text-[11.5px] text-text-muted m-0">filters, dashboards and reports load together</p>
        </div>
      ) : (
        <>
          <FilterPanel options={filterOptions} available={analytics?.available ?? null} filter={filter} onChange={setFilter} />
          <div className="relative">
            {/* Each container carries its own loading veil (see MarketAnalytics) instead of
                one whole-page blur: the previous numbers stay put per-card while a filter
                change is in flight, each card blocks clicks on its own stale content, and
                unrelated chrome (filter panel, report launcher) never freezes with it. */}
            <div key={mode} className="flex flex-col gap-4 min-w-0 fade-in-soft">
              <MarketAnalytics data={analytics} error={analyticsError} mode={mode} options={filterOptions} loading={analyticsLoading} />
              <ReportsLauncher filter={filter} />
            </div>
            <FloatingAnalyticsChat filter={filter} />
          </div>
        </>
      )}
    </div>
  );
}
