"use client";

import { useReducedMotion } from "motion/react";
import { Children, useCallback, useEffect, useRef, useState, type ReactNode } from "react";

/**
 * Horizontally scrollable row with center-focus clarity: items near the container's
 * horizontal center render sharp and at full size/opacity, items toward either edge blur
 * and shrink slightly as they scroll out — the "wheel" carousel treatment used for
 * Knowledge Base's content tiles and AI Assistant's agent tiles (Phases 7-8). Recomputes
 * per-item focus on scroll/resize via rAF, not on every scroll event, to stay cheap with
 * a few dozen tiles. Under prefers-reduced-motion every item just renders at full focus —
 * this is a decorative depth effect, not information, so turning it off costs nothing.
 */
export default function ScrollCarousel({
  children,
  className,
  itemClassName,
  gap = 20,
}: {
  children: ReactNode;
  className?: string;
  itemClassName?: string;
  gap?: number;
}) {
  const reduceMotion = useReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<(HTMLDivElement | null)[]>([]);
  const rafRef = useRef(0);
  const items = Children.toArray(children);
  const [focus, setFocus] = useState<number[]>(() => items.map(() => 1));

  const updateFocus = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const containerRect = container.getBoundingClientRect();
    const centerX = containerRect.left + containerRect.width / 2;
    const halfWidth = containerRect.width / 2 || 1;
    setFocus(
      itemRefs.current.map((el) => {
        if (!el) return 1;
        const r = el.getBoundingClientRect();
        const itemCenter = r.left + r.width / 2;
        const distance = Math.min(1, Math.abs(itemCenter - centerX) / halfWidth);
        return 1 - distance;
      }),
    );
  }, []);

  useEffect(() => {
    if (reduceMotion) return;
    updateFocus();
    const container = containerRef.current;
    if (!container) return;

    const onScroll = () => {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(updateFocus);
    };
    container.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      container.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
      cancelAnimationFrame(rafRef.current);
    };
  }, [reduceMotion, updateFocus, items.length]);

  return (
    <div
      ref={containerRef}
      className={className}
      style={{
        display: "flex",
        gap,
        overflowX: "auto",
        scrollSnapType: reduceMotion ? undefined : "x proximity",
        WebkitOverflowScrolling: "touch",
      }}
    >
      {items.map((child, i) => {
        const f = reduceMotion ? 1 : (focus[i] ?? 1);
        return (
          <div
            key={i}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            className={itemClassName}
            style={{
              scrollSnapAlign: reduceMotion ? undefined : "center",
              flexShrink: 0,
              filter: reduceMotion ? undefined : `blur(${(1 - f) * 3}px)`,
              opacity: reduceMotion ? 1 : 0.55 + f * 0.45,
              transform: reduceMotion ? undefined : `scale(${0.92 + f * 0.08})`,
              transition: "filter 0.15s linear, opacity 0.15s linear, transform 0.15s linear",
            }}
          >
            {child}
          </div>
        );
      })}
    </div>
  );
}
