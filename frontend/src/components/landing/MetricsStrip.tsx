import type { LandingPlatformStat } from "@/types/api";

/**
 * The live metrics strip — a dark full-width stats belt (the standard landing-page contrast
 * band between feature sections), using the same `--tea-ink` ground the internal Market Pulse
 * ticker already uses, so the one dark band on this page still reads as this app's own
 * palette rather than a foreign accent color. `isLive`-flagged stats already carry a real
 * platform count by the time they reach this component (see
 * LandingPageContentController.ResolveLiveStatsAsync) — this just renders whatever value it's
 * given, live or CMS-entered, identically.
 */
export default function MetricsStrip({ stats }: { stats: LandingPlatformStat[] }) {
  return (
    <section className="py-14 sm:py-16" style={{ background: "var(--tea-ink)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-6 text-center">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="font-mono font-bold leading-tight" style={{ color: "#FFFDF7", fontSize: "clamp(26px, 3vw, 36px)" }}>
              {s.value}
            </div>
            <div className="font-mono text-[11px] tracking-[0.1em] uppercase mt-2" style={{ color: "rgba(244,241,230,0.65)" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
