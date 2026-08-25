"use client";

import PageHeader from "@/components/shared/PageHeader";
import { SkeletonRows } from "@/components/shared/SkeletonBlock";
import { api } from "@/lib/api";
import type { PerformanceInsight } from "@/types/api";
import { useEffect, useState } from "react";

/** One finding, reusing Market Intelligence's Insights-card visual pattern verbatim —
 *  bordered card, small dot bullet, plain-English sentence — rather than a new one.
 *  `description` is already a complete, server-built sentence, so it just renders as-is. */
function InsightCard({ insight }: { insight: PerformanceInsight }) {
  return (
    <div className="border border-border rounded-[var(--radius-lg)] bg-surface px-3.5 py-3 text-[13px] text-text flex gap-2.5 items-start">
      <span className="w-1.5 h-1.5 rounded-full bg-text-muted mt-1.5 shrink-0" />
      <span>{insight.description}</span>
    </div>
  );
}

function InsightSection({ title, subtitle, insights, emptyMessage }: {
  title: string;
  subtitle: string;
  insights: PerformanceInsight[];
  emptyMessage: string;
}) {
  return (
    <section className="mb-6">
      <div className="flex items-baseline gap-2.5 mb-2.5">
        <h4 className="font-display text-[15px] font-semibold text-text-strong m-0">{title}</h4>
        <span className="text-[12px] text-text-muted">{subtitle}</span>
      </div>
      {insights.length > 0 ? (
        <div className="flex flex-col gap-2">
          {insights.map((insight, idx) => (
            <InsightCard key={idx} insight={insight} />
          ))}
        </div>
      ) : (
        <p className="text-[12px] text-text-muted m-0">{emptyMessage}</p>
      )}
    </section>
  );
}

export default function PerformancePage() {
  const [insights, setInsights] = useState<PerformanceInsight[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    api
      .getPerformanceInsights()
      .then(setInsights)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load performance insights"))
      .finally(() => setLoading(false));
  }, []);

  const gradeInsights = insights?.filter((i) => i.dimension === "Grade") ?? [];
  const buyerInsights = insights?.filter((i) => i.dimension === "Buyer") ?? [];

  return (
    <div>
      <PageHeader
        title="Performance"
        subtitle="Sustained grade and buyer trends, computed across recent sales."
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      {loading ? (
        <SkeletonRows rows={4} />
      ) : (
        <>
          <InsightSection
            title="Grade Trends"
            subtitle="Sustained valuation streaks across the last several sales"
            insights={gradeInsights}
            emptyMessage="No grade has a sustained streak strong enough to surface yet."
          />
          <InsightSection
            title="Buyer Trends"
            subtitle="Meaningful purchase-volume swings vs. a buyer's own recent average"
            insights={buyerInsights}
            emptyMessage="No buyer's purchase volume has swung enough to surface yet."
          />
        </>
      )}
    </div>
  );
}
