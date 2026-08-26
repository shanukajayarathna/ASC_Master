"use client";

import type { LandingPlatformStat } from "@/types/api";
import { useEffect, useRef, useState } from "react";

/** Splits "12,400", "60+", "99.2%", "1,234" into a numeric core plus surrounding text, so the
 *  count-up only animates the number and the original prefix/suffix (e.g. "+", "%") is kept
 *  exactly as entered. Falls back to showing the raw string with no animation when there's no
 *  parseable number in it. */
function parseValue(raw: string): { prefix: string; target: number; decimals: number; suffix: string } | null {
  const match = raw.match(/^([^\d]*)([\d,]*\d(?:\.\d+)?)(.*)$/);
  if (!match) return null;
  const [, prefix, numPart, suffix] = match;
  const decimals = numPart.includes(".") ? numPart.split(".")[1].length : 0;
  const target = Number(numPart.replace(/,/g, ""));
  if (Number.isNaN(target)) return null;
  return { prefix, target, decimals, suffix };
}

function CountUpValue({ raw }: { raw: string }) {
  const parsed = parseValue(raw);
  const [display, setDisplay] = useState(parsed ? "0" : raw);
  const ref = useRef<HTMLSpanElement>(null);
  const started = useRef(false);

  useEffect(() => {
    if (!parsed || !ref.current) return;
    const el = ref.current;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting || started.current) return;
        started.current = true;
        observer.disconnect();

        const durationMs = 1200;
        const startTime = performance.now();
        const tick = (now: number) => {
          const progress = Math.min(1, (now - startTime) / durationMs);
          const eased = 1 - Math.pow(1 - progress, 3);
          const current = parsed.target * eased;
          setDisplay(
            current.toLocaleString(undefined, { minimumFractionDigits: parsed.decimals, maximumFractionDigits: parsed.decimals })
          );
          if (progress < 1) requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      },
      { threshold: 0.4 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [parsed]);

  if (!parsed) return <>{raw}</>;
  return (
    <span ref={ref}>
      {parsed.prefix}
      {display}
      {parsed.suffix}
    </span>
  );
}

/**
 * The metrics strip's one motion treatment: each number counts up once when it scrolls into
 * view (spec 2.4 #4). `isLive`-flagged stats already carry a real platform count by the time
 * they reach this component (see LandingPageContentController.ResolveLiveStatsAsync) — this
 * component just renders whatever value it's given, live or CMS-entered, identically.
 */
export default function MetricsStrip({ stats }: { stats: LandingPlatformStat[] }) {
  return (
    <section className="py-16 sm:py-20" style={{ background: "var(--tea-ink)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 grid grid-cols-2 lg:grid-cols-4 gap-8 sm:gap-10">
        {stats.map((s) => (
          <div key={s.label} className="text-center">
            <p className="font-display font-bold m-0" style={{ color: "#FFFDF7", fontSize: "clamp(30px, 4vw, 44px)" }}>
              <CountUpValue raw={s.value} />
            </p>
            <p className="font-mono text-[10.5px] tracking-[0.12em] uppercase m-0 mt-2" style={{ color: "rgba(244,241,230,0.65)" }}>
              {s.label}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
