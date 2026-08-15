"use client";

import { useEffect, useState } from "react";

export interface KpiSlideTile {
  label: string;
  value: string;
}

export interface KpiSlide {
  title: string;
  subtitle?: string;
  tiles: KpiSlideTile[];
}

/**
 * The detailed KPI breakdown (Valuation Range / Portfolio Composition / Weight & Volume)
 * as one compact card with manually switched sections — same data, less vertical space.
 * Deliberately NOT auto-rotating (this replaced AutoSlidingKpiPanel): a timer that swaps
 * content mid-read tests badly and pulls attention on every cycle, so the reader picks
 * the section themselves via labeled tabs.
 */
export default function KpiSlidesPanel({ slides }: { slides: KpiSlide[] }) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (index >= slides.length) setIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];

  return (
    <div
      className="mb-6 rounded-[var(--radius-lg)] border border-border p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {slides.length > 1 ? (
          <div className="flex items-center gap-1" role="tablist" aria-label="KPI sections">
            {slides.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                onClick={() => setIndex(i)}
                aria-selected={i === index}
                className="px-2.5 py-1 rounded-full border-0 cursor-pointer text-[12px] font-semibold"
                style={{
                  background: i === index ? "var(--brass-dim)" : "transparent",
                  color: i === index ? "var(--liquor)" : "var(--text-muted)",
                  transition: "background 150ms ease, color 150ms ease",
                }}
              >
                {s.title}
              </button>
            ))}
          </div>
        ) : (
          <h3 className="font-display text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
            {slide.title}
          </h3>
        )}
        {slide.subtitle && (
          <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {slide.subtitle}
          </span>
        )}
      </div>
      <div
        key={slide.title}
        className="grid gap-3"
        style={{ gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))" }}
      >
        {slide.tiles.map((t) => (
          <div key={t.label} className="min-w-0">
            <div className="font-mono text-[17px] font-semibold truncate" style={{ color: "var(--text-strong)" }}>
              {t.value}
            </div>
            <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
              {t.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
