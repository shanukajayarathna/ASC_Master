"use client";

import MarketAccuracyAnalysis from "@/components/analytics/MarketAccuracyAnalysis";
import PageHeader from "@/components/shared/PageHeader";

// Folded into Analytical Reports (Analysis) as its "Market Accuracy" tab (Phase 9 IA
// consolidation) — this route stays live as a direct entry point to the exact same
// component, same pattern as every other "hiddenFromGrid" module in nav.ts.
export default function MarketPage() {
  return (
    <div>
      <PageHeader
        title="Market Intelligence"
        subtitle="Compare estimates against actual auction prices — accuracy and insights."
      />
      <MarketAccuracyAnalysis />
    </div>
  );
}
