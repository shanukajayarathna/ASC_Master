"use client";

import { useLayoutEffect, useRef, useState } from "react";

/**
 * Height (px) that makes an element fill the rest of the window: from wherever it starts to the bottom edge, less `bottomGap`
 * (which covers the page's own bottom padding, so the page itself never needs to scroll). Re-measured when the window
 * resizes or anything above it changes the page height. Null until the first measure; never smaller than `minHeight`.
 */
export function useFillHeight<T extends HTMLElement>(minHeight: number, bottomGap = 32) {
  const ref = useRef<T>(null);
  const [height, setHeight] = useState<number | null>(null);
  useLayoutEffect(() => {
    let frame = 0;
    const measure = () => {
      const el = ref.current;
      if (!el) return;
      const top = el.getBoundingClientRect().top + window.scrollY;
      setHeight(Math.max(minHeight, Math.floor(window.innerHeight - top - bottomGap)));
    };
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    measure();
    window.addEventListener("resize", schedule);
    const observer = new ResizeObserver(schedule);
    observer.observe(document.body);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", schedule);
      observer.disconnect();
    };
  }, [minHeight, bottomGap]);
  return { ref, height };
}
