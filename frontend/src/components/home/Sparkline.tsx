"use client";

interface SparklineProps {
  /** Chronological, oldest first. Needs at least 2 points to draw a line. */
  values: number[];
  color: string;
  width?: number;
  height?: number;
}

/** A minimal inline-SVG trend line — no charting library, just a polyline, so it stays
 *  free on a weak CPU/GPU (the same constraint the rest of this redesign was built under). */
export default function Sparkline({ values, color, width = 72, height = 24 }: SparklineProps) {
  if (values.length < 2) return null;

  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const stepX = width / (values.length - 1);

  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(height - ((v - min) / span) * height).toFixed(1)}`)
    .join(" ");

  const last = values[values.length - 1];
  const lastY = height - ((last - min) / span) * height;

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="shrink-0">
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.75} strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={width} cy={lastY} r={2} fill={color} />
    </svg>
  );
}
