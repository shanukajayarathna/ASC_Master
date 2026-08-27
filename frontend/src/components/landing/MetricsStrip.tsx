import type { LandingPlatformStat } from "@/types/api";

/**
 * The live metrics strip — same bordered/divided KPI-strip pattern the dashboard's own glance
 * bar uses (`font-mono` numbers, muted labels), rather than a bespoke animated counter block.
 * `isLive`-flagged stats already carry a real platform count by the time they reach this
 * component (see LandingPageContentController.ResolveLiveStatsAsync) — this component just
 * renders whatever value it's given, live or CMS-entered, identically.
 */
export default function MetricsStrip({ stats }: { stats: LandingPlatformStat[] }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <div
        className="rounded-[var(--radius-lg)] border border-border grid"
        style={{ background: "var(--surface)", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
      >
        {stats.map((s, i) => (
          <div key={s.label} className="p-4" style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}>
            <div className="font-mono text-[22px] font-semibold leading-tight" style={{ color: "var(--text-strong)" }}>
              {s.value}
            </div>
            <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
