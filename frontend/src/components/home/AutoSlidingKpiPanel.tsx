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

const INTERVAL_MS = 5000;

/**
 * The detailed KPI breakdown (Valuation Range / Portfolio Composition / Weight & Volume)
 * as one compact auto-rotating card instead of three stacked sections — same data, less
 * vertical space. Pauses on hover/focus (so reading one slide doesn't get interrupted),
 * and under prefers-reduced-motion it still rotates on the same timer but swaps instantly
 * rather than animating — the content change itself is informational, not decorative
 * motion, so it stays; only the transition animation is dropped.
 */
export default function AutoSlidingKpiPanel({ slides }: { slides: KpiSlide[] }) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (index >= slides.length) setIndex(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slides.length]);

  useEffect(() => {
    if (paused || slides.length <= 1) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % slides.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [paused, slides.length]);

  if (slides.length === 0) return null;
  const slide = slides[Math.min(index, slides.length - 1)];

  return (
    <div
      className="mb-6 rounded-[var(--radius-lg)] border border-border p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        <h3 className="font-display text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
          {slide.title}
        </h3>
        {slide.subtitle && (
          <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
            {slide.subtitle}
          </span>
        )}
        {slides.length > 1 && (
          <div className="ml-auto flex items-center gap-1.5" role="tablist" aria-label="KPI sections">
            {slides.map((s, i) => (
              <button
                key={s.title}
                type="button"
                role="tab"
                onClick={() => setIndex(i)}
                aria-label={`Show ${s.title}`}
                aria-selected={i === index}
                className="rounded-full cursor-pointer border-0 p-0"
                style={{
                  width: i === index ? 16 : 6,
                  height: 6,
                  background: i === index ? "var(--liquor)" : "var(--border)",
                  transition: "width 200ms ease, background 200ms ease",
                }}
              />
            ))}
          </div>
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
