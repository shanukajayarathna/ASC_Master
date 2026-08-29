"use client";

import { animate, useInView, useReducedMotion } from "motion/react";
import { useEffect, useRef, useState } from "react";

interface ParsedValue {
  prefix: string;
  suffix: string;
  target: number;
  format: (n: number) => string;
}

/**
 * Stats come from the CMS as free-form strings ("12,450+", "98%", "24/7") rather than clean
 * integers, so the numeric part is extracted defensively and the surrounding text/formatting
 * (comma grouping, decimals, prefix/suffix) is preserved on the way back out. Returns null when
 * no number is found so the caller can fall back to rendering the raw string.
 */
function parseValue(raw: string): ParsedValue | null {
  const match = raw.match(/-?[\d,]+(\.\d+)?/);
  if (!match) return null;

  const numStr = match[0];
  const target = parseFloat(numStr.replace(/,/g, ""));
  if (Number.isNaN(target)) return null;

  const useCommas = numStr.includes(",");
  const decimals = numStr.includes(".") ? numStr.split(".")[1].length : 0;

  return {
    prefix: raw.slice(0, match.index ?? 0),
    suffix: raw.slice((match.index ?? 0) + numStr.length),
    target,
    format: (n: number) =>
      decimals ? n.toFixed(decimals) : useCommas ? Math.round(n).toLocaleString("en-US") : String(Math.round(n)),
  };
}

export default function CountUp({ value, duration = 1.4 }: { value: string; duration?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, amount: 0.5 });
  const reduceMotion = useReducedMotion();
  const parsed = parseValue(value);
  const [display, setDisplay] = useState(() => (parsed ? parsed.format(0) : value));

  useEffect(() => {
    if (!parsed || !inView || reduceMotion) return;

    const controls = animate(0, parsed.target, {
      duration,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => setDisplay(parsed.format(v)),
    });
    return () => controls.stop();
    // parsed/duration are derived from `value`, which is effectively static per stat card.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inView, reduceMotion]);

  if (!parsed) return <span>{value}</span>;

  // Under reduced motion, skip the tick animation entirely and render the final value directly.
  const shown = reduceMotion ? parsed.format(parsed.target) : display;

  return (
    <span ref={ref}>
      {parsed.prefix}
      {shown}
      {parsed.suffix}
    </span>
  );
}
