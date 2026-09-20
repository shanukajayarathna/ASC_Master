"use client";

/* eslint-disable security/detect-object-injection --
   Every index here is a numeric position into arrays whose lengths parseChartSpec has already
   validated; broker-code lookups are guarded with Object.hasOwn. */

import { BROKERS, brokerPaletteCss } from "@/lib/brokers";
import { useEffect, useRef, useState } from "react";
import { ChatTable } from "./RichText";

/** A chart the Reports Agent built (make_chart). The spec arrives as a fenced ```asc-chart JSON
 *  block inside an assistant message — model/tool output, so it is validated before drawing and
 *  every label goes in as text, never markup. */
export type ChartType = "bar" | "horizontal_bar" | "stacked_bar" | "percent_stacked_bar" | "line" | "pie";

export interface ChartSpec {
  type: ChartType;
  title: string;
  subtitle?: string;
  unit: string;
  categoryAxis?: string;
  categories: string[];
  series: { name: string; values: (number | null)[] }[];
}

const TYPES: ChartType[] = ["bar", "horizontal_bar", "stacked_bar", "percent_stacked_bar", "line", "pie"];
const MAX_CATEGORIES = 40;
const MAX_SERIES = 14;

export function parseChartSpec(json: string): ChartSpec | null {
  try {
    const s = JSON.parse(json);
    if (!TYPES.includes(s?.type) || typeof s.title !== "string") return null;
    if (!Array.isArray(s.categories) || !Array.isArray(s.series)) return null;
    if (s.categories.length === 0 || s.categories.length > MAX_CATEGORIES) return null;
    if (s.series.length === 0 || s.series.length > MAX_SERIES) return null;
    const categories = s.categories.map(String);
    const series = s.series.map((x: { name: unknown; values: unknown }) => ({
      name: String(x.name),
      values: Array.isArray(x.values) ? x.values.map((v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null)) : [],
    }));
    if (series.some((x: { values: unknown[] }) => x.values.length !== categories.length)) return null;
    return {
      type: s.type,
      title: s.title,
      subtitle: typeof s.subtitle === "string" ? s.subtitle : undefined,
      unit: typeof s.unit === "string" ? s.unit : "",
      categoryAxis: typeof s.categoryAxis === "string" ? s.categoryAxis : undefined,
      categories,
      series,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------- colour
// Brokers wear the app's own broker identity (lib/brokers.ts — the company's portal colours,
// "colour follows the broker permanently"), so ASC is the same colour here as on every other
// screen. Anything else (grades, elevations…) takes the categorical slots in fixed order, never
// cycled (see globals.css); a ninth series folds to the neutral "Other".
const BROKER_KEY_BY_CODE: Record<string, string> = Object.fromEntries(Object.entries(BROKERS).map(([key, b]) => [b.code, key]));
const isBroker = (name: string) => Object.hasOwn(BROKER_KEY_BY_CODE, name);

export function seriesColor(name: string, index: number): string {
  if (name === "Other") return "var(--series-other)";
  if (isBroker(name)) return `var(--broker-${BROKER_KEY_BY_CODE[name]})`;
  return index < 8 ? `var(--series-${index + 1})` : "var(--series-other)";
}

/** One bar's colour when a single series is drawn over categories: each broker keeps its own
 *  colour, everything else uses the lead slot. */
const barColor = (category: string) => (isBroker(category) ? seriesColor(category, 0) : "var(--series-1)");

// ---------------------------------------------------------------------------- number formatting
const compact = (v: number) => {
  const a = Math.abs(v);
  if (a >= 1e9) return `${+(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${+(v / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${+(v / 1e3).toFixed(1)}K`;
  return `${+v.toFixed(1)}`;
};
const full = (v: number | null, unit: string) =>
  v === null ? "–" : v.toLocaleString(undefined, { maximumFractionDigits: unit === "Rs/kg" ? 2 : 0 });

/** Round axis: a "nice" step (1/2/5 × 10ⁿ) so ticks read 0 / 1,000 / 2,000, never 0 / 1,137. */
function niceScale(max: number, target = 4): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };
  const raw = max / target;
  const pow = 10 ** Math.floor(Math.log10(raw));
  const step = ([1, 2, 5, 10].find((m) => m * pow >= raw) ?? 10) * pow;
  const top = Math.ceil(max / step) * step;
  return { max: top, ticks: Array.from({ length: Math.round(top / step) + 1 }, (_, i) => +(i * step).toFixed(6)) };
}

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, Math.max(1, n - 1))}…` : s);

/** Bar with a 4px rounded data-end and a square baseline end. */
function barPath(x: number, y: number, w: number, h: number, horizontal: boolean, round = true): string {
  if (w <= 0 || h <= 0) return "";
  const r = round ? Math.min(4, (horizontal ? h : w) / 2, (horizontal ? w : h)) : 0;
  return horizontal
    ? `M${x},${y}h${w - r}a${r},${r} 0 0 1 ${r},${r}v${h - 2 * r}a${r},${r} 0 0 1 -${r},${r}h-${w - r}z`
    : `M${x},${y + h}v-${h - r}a${r},${r} 0 0 1 ${r},-${r}h${w - 2 * r}a${r},${r} 0 0 1 ${r},${r}v${h - r}z`;
}

function useWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(600);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => setW(Math.max(240, Math.floor(el.clientWidth))));
    ro.observe(el);
    setW(Math.max(240, Math.floor(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  return [ref, w];
}

interface Hover {
  index: number;
  x: number;
}

function Tooltip({ spec, hover, width, percent }: { spec: ChartSpec; hover: Hover; width: number; percent: boolean }) {
  const cat = spec.categories[hover.index];
  const rows = spec.series.map((s, i) => ({ name: s.name, value: s.values[hover.index], color: seriesColor(s.name, i) }));
  const total = rows.reduce((a, r) => a + (r.value ?? 0), 0);
  const shown = rows.filter((r) => r.value !== null).sort((a, b) => (b.value ?? 0) - (a.value ?? 0));
  const tw = 200;
  const left = Math.min(Math.max(hover.x, tw / 2 + 4), width - tw / 2 - 4);
  return (
    <div
      role="tooltip"
      className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface shadow-md px-2.5 py-2 text-[12px]"
      style={{ left, top: 4, width: tw, transform: "translateX(-50%)" }}
    >
      <div className="text-text-muted mb-1">{cat}</div>
      {shown.map((r) => (
        <div key={r.name} className="flex items-center gap-2">
          <span aria-hidden className="inline-block w-3 h-[3px] rounded-full shrink-0" style={{ background: r.color }} />
          <span className="text-text-muted truncate flex-1">{r.name}</span>
          <span className="font-semibold text-text-strong tabular-nums">
            {full(r.value, spec.unit)}
            {percent && total > 0 ? ` · ${(((r.value ?? 0) / total) * 100).toFixed(1)}%` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------- column / line
function ColumnChart({ spec, w, kind }: { spec: ChartSpec; w: number; kind: "bar" | "stacked" | "percent" | "line" }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const H = 260;
  const m = { l: 52, r: 12, t: 10, b: 34 };
  const pw = w - m.l - m.r;
  const ph = H - m.t - m.b;
  const n = spec.categories.length;
  const band = pw / n;
  const sums = spec.categories.map((_, c) => spec.series.reduce((a, s) => a + (s.values[c] ?? 0), 0));
  const rawMax =
    kind === "percent" ? 100
    : kind === "stacked" ? Math.max(...sums, 0)
    : Math.max(...spec.series.flatMap((s) => s.values.map((v) => v ?? 0)), 0);
  const { max, ticks } = niceScale(rawMax);
  const y = (v: number) => m.t + ph - (v / max) * ph;
  const xc = (c: number) => m.l + band * (c + 0.5);
  const single = spec.series.length === 1;
  const colorOf = (i: number, c = 0) => (single && kind !== "line" ? barColor(spec.categories[c]) : seriesColor(spec.series[i].name, i));
  const labelStride = Math.max(1, Math.ceil(46 / band));
  const maxChars = Math.max(3, Math.floor((band * labelStride) / 6.2));
  const groupN = kind === "bar" ? spec.series.length : 1;
  const barW = Math.min(24, Math.max(4, (band * 0.7 - (groupN - 1) * 2) / groupN));

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label={spec.title} className="block">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={w - m.r} y1={y(t)} y2={y(t)} stroke={t === 0 ? "var(--viz-baseline)" : "var(--viz-grid)"} strokeWidth={1} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {kind === "percent" ? `${t}%` : compact(t)}
            </text>
          </g>
        ))}

        {spec.categories.map((c, i) =>
          i % labelStride === 0 ? (
            <text key={c + i} x={xc(i)} y={H - 12} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {truncate(c, maxChars)}
            </text>
          ) : null,
        )}

        {kind === "line" &&
          spec.series.map((s, si) => {
            const segs: string[] = [];
            let open = false;
            s.values.forEach((v, c) => {
              if (v === null) { open = false; return; }
              segs.push(`${open ? "L" : "M"}${xc(c)},${y(v)}`);
              open = true;
            });
            return (
              <g key={s.name}>
                <path d={segs.join("")} fill="none" stroke={colorOf(si)} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                {s.values.map((v, c) =>
                  v === null ? null : <circle key={c} cx={xc(c)} cy={y(v)} r={4} fill={colorOf(si)} stroke="var(--surface)" strokeWidth={2} />,
                )}
              </g>
            );
          })}

        {kind === "bar" &&
          spec.series.map((s, si) =>
            s.values.map((v, c) => {
              if (!v) return null;
              const groupW = groupN * barW + (groupN - 1) * 2;
              const x = xc(c) - groupW / 2 + si * (barW + 2);
              const h = (v / max) * ph;
              return (
                <g key={`${si}-${c}`} opacity={hover && hover.index !== c ? 0.55 : 1}>
                  <path d={barPath(x, y(v), barW, h, false)} fill={colorOf(si, c)} />
                  {single && n <= 8 && (
                    <text x={x + barW / 2} y={y(v) - 5} textAnchor="middle" fontSize={11} fill="var(--text-strong)">
                      {compact(v)}
                    </text>
                  )}
                </g>
              );
            }),
          )}

        {(kind === "stacked" || kind === "percent") &&
          spec.categories.map((_, c) => {
            const total = sums[c];
            let acc = 0;
            const lastIdx = spec.series.reduce((l, s, i) => ((s.values[c] ?? 0) > 0 ? i : l), -1);
            return (
              <g key={c} opacity={hover && hover.index !== c ? 0.55 : 1}>
                {spec.series.map((s, si) => {
                  const v = s.values[c] ?? 0;
                  if (v <= 0 || total <= 0) return null;
                  const scaled = kind === "percent" ? (v / total) * 100 : v;
                  const top = acc + scaled;
                  const segTop = y(top);
                  const segBottom = y(acc);
                  acc = top;
                  // 2px surface gap between touching segments (no strokes) — shave the segment.
                  const h = Math.max(0, segBottom - segTop - (si === 0 ? 0 : 2));
                  return <path key={s.name} d={barPath(xc(c) - barW / 2, segTop, barW, h, false, si === lastIdx)} fill={colorOf(si)} />;
                })}
              </g>
            );
          })}

        {kind === "line" && hover && <line x1={xc(hover.index)} x2={xc(hover.index)} y1={m.t} y2={m.t + ph} stroke="var(--viz-baseline)" strokeWidth={1} />}

        {/* Hit targets: one full-height band per category — far bigger than any mark. */}
        {spec.categories.map((c, i) => (
          <rect
            key={c + i}
            x={m.l + band * i}
            y={m.t}
            width={band}
            height={ph}
            fill="transparent"
            tabIndex={0}
            aria-label={`${c}: ${spec.series.map((s) => `${s.name} ${full(s.values[i], spec.unit)}`).join(", ")}`}
            onPointerMove={() => setHover({ index: i, x: xc(i) })}
            onFocus={() => setHover({ index: i, x: xc(i) })}
            onBlur={() => setHover(null)}
            style={{ outline: "none" }}
          />
        ))}
      </svg>
      {hover && <Tooltip spec={spec} hover={hover} width={w} percent={kind === "percent"} />}
    </div>
  );
}

// ---------------------------------------------------------------------------- horizontal bars
function HorizontalBars({ spec, w, showShare }: { spec: ChartSpec; w: number; showShare?: boolean }) {
  const [hover, setHover] = useState<Hover | null>(null);
  const values = spec.series[0].values;
  const total = values.reduce((a: number, v) => a + (v ?? 0), 0);
  const rowH = 30;
  const m = { l: Math.min(140, Math.max(64, Math.floor(w * 0.28))), r: 64, t: 4, b: 4 };
  const H = spec.categories.length * rowH + m.t + m.b;
  const pw = w - m.l - m.r;
  const max = niceScale(Math.max(...values.map((v) => v ?? 0), 0)).max;
  const maxChars = Math.floor((m.l - 12) / 6.2);

  return (
    <div className="relative" onPointerLeave={() => setHover(null)}>
      <svg width={w} height={H} role="img" aria-label={spec.title} className="block">
        <line x1={m.l} x2={m.l} y1={m.t} y2={H - m.b} stroke="var(--viz-baseline)" strokeWidth={1} />
        {spec.categories.map((c, i) => {
          const v = values[i] ?? 0;
          const cy = m.t + i * rowH;
          const bw = (v / max) * pw;
          const share = total > 0 ? (v / total) * 100 : 0;
          return (
            <g key={c + i} opacity={hover && hover.index !== i ? 0.55 : 1}>
              <text x={m.l - 8} y={cy + rowH / 2 + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
                {truncate(c, maxChars)}
              </text>
              <path d={barPath(m.l, cy + (rowH - 20) / 2, bw, 20, true)} fill={barColor(c)} />
              <text x={m.l + bw + 6} y={cy + rowH / 2 + 4} fontSize={11} fill="var(--text-strong)">
                {showShare && total > 0 ? `${share.toFixed(1)}%` : compact(v)}
              </text>
              <rect
                x={0} y={cy} width={w} height={rowH} fill="transparent" tabIndex={0}
                aria-label={`${c}: ${full(values[i], spec.unit)}${total > 0 ? ` (${share.toFixed(1)}%)` : ""}`}
                onPointerMove={() => setHover({ index: i, x: Math.min(m.l + bw, w - 110) })}
                onFocus={() => setHover({ index: i, x: Math.min(m.l + bw, w - 110) })}
                onBlur={() => setHover(null)}
                style={{ outline: "none" }}
              />
            </g>
          );
        })}
      </svg>
      {hover && <Tooltip spec={spec} hover={hover} width={w} percent />}
    </div>
  );
}

// ---------------------------------------------------------------------------- donut (<= 6 slices)
function Donut({ spec }: { spec: ChartSpec }) {
  const [active, setActive] = useState<number | null>(null);
  const values = spec.series[0].values.map((v) => Math.max(0, v ?? 0));
  const total = values.reduce((a, v) => a + v, 0);
  const size = 168;
  const r = 70;
  const cx = size / 2;
  const cy = size / 2;
  const sweeps = values.map((v) => (total > 0 ? (v / total) * Math.PI * 2 : 0));
  const arcs = values.map((_, i) => {
    const sweep = sweeps[i];
    const a0 = -Math.PI / 2 + sweeps.slice(0, i).reduce((a, b) => a + b, 0);
    const a1 = a0 + sweep - 0.0001;
    const large = sweep > Math.PI ? 1 : 0;
    const p = (a: number, rad: number) => `${cx + rad * Math.cos(a)},${cy + rad * Math.sin(a)}`;
    const d = sweep > 0
      ? `M${p(a0, r)}A${r},${r} 0 ${large} 1 ${p(a1, r)}L${p(a1, r - 26)}A${r - 26},${r - 26} 0 ${large} 0 ${p(a0, r - 26)}z`
      : "";
    return { d, i };
  });
  const shown = active !== null ? active : null;

  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
      <svg width={size} height={size} role="img" aria-label={spec.title} className="block shrink-0" onPointerLeave={() => setActive(null)}>
        {arcs.map(({ d, i }) =>
          d ? (
            <path
              key={i} d={d} fill={seriesColor(spec.categories[i], i)} stroke="var(--surface)" strokeWidth={2}
              opacity={shown !== null && shown !== i ? 0.55 : 1} tabIndex={0}
              aria-label={`${spec.categories[i]}: ${full(values[i], spec.unit)} (${total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0}%)`}
              onPointerEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)}
              style={{ outline: "none" }}
            />
          ) : null,
        )}
        <text x={cx} y={cy - 2} textAnchor="middle" fontSize={16} fontWeight={600} fill="var(--text-strong)">
          {shown !== null ? `${total > 0 ? ((values[shown] / total) * 100).toFixed(1) : 0}%` : compact(total)}
        </text>
        <text x={cx} y={cy + 16} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
          {shown !== null ? truncate(spec.categories[shown], 16) : spec.unit}
        </text>
      </svg>
      <ul className="m-0 p-0 list-none flex flex-col gap-1 text-[12px] min-w-[160px] flex-1">
        {spec.categories.map((c, i) => (
          <li key={c + i} className="flex items-center gap-2" onPointerEnter={() => setActive(i)} onPointerLeave={() => setActive(null)}>
            <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: seriesColor(c, i) }} />
            <span className="text-text-muted flex-1 truncate">{c}</span>
            <span className="font-semibold text-text-strong tabular-nums">{full(spec.series[0].values[i], spec.unit)}</span>
            <span className="text-text-muted tabular-nums w-12 text-right">{total > 0 ? ((values[i] / total) * 100).toFixed(1) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------- PNG export
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "chart";

/** Word-wrap `text` to `maxWidth` using the canvas's current font. */
function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  for (const word of text.split(/\s+/)) {
    const next = line ? `${line} ${word}` : word;
    if (line && ctx.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/**
 * Saves the rendered chart as a PNG (title, scope line, chart, legend) for pasting into a slide or
 * email. The chart's colours are CSS variables, which mean nothing outside the page, so they are
 * resolved against the figure's computed style — the image matches the current light/dark theme.
 */
async function downloadPng(fig: HTMLElement | null, spec: ChartSpec) {
  const svg = fig?.querySelector("svg");
  if (!fig || !svg) return;
  const cs = getComputedStyle(fig);
  const css = (name: string) => cs.getPropertyValue(name).trim();
  const resolve = (v: string) => v.replace(/var\((--[\w-]+)\)/g, (_, n: string) => css(n) || "#888888");
  const font = cs.fontFamily || "sans-serif";

  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("font-family", font);
  clone.querySelectorAll<SVGElement>("*").forEach((el) => {
    for (const attr of ["fill", "stroke"]) {
      const v = el.getAttribute(attr);
      if (v?.includes("var(")) el.setAttribute(attr, resolve(v));
    }
  });
  const cw = svg.width.baseVal.value;
  const ch = svg.height.baseVal.value;
  const image = new Image();
  const loaded = new Promise<void>((ok, fail) => {
    image.onload = () => ok();
    image.onerror = () => fail(new Error("chart image failed to load"));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(clone))}`;
  await loaded;

  const scale = 2;
  const pad = 16;
  const width = Math.max(cw, 420) + pad * 2;
  const measure = document.createElement("canvas").getContext("2d");
  if (!measure) return;
  measure.font = `600 15px ${font}`;
  const titleLines = wrapLines(measure, spec.title, width - pad * 2);
  measure.font = `12px ${font}`;
  const subLines = spec.subtitle ? wrapLines(measure, spec.subtitle, width - pad * 2) : [];
  const legend = (spec.type === "pie" && spec.series.length === 1 ? spec.categories : spec.series.map((s) => s.name)).map((name, i) => ({
    name,
    color: resolve(seriesColor(name, i)),
  }));
  const showLegend = legend.length > 1;
  // Lay the legend out first so the canvas height is known.
  const legendRows: { name: string; color: string; x: number; row: number }[] = [];
  let lx = pad;
  let row = 0;
  for (const item of legend) {
    const iw = measure.measureText(item.name).width + 26;
    if (lx + iw > width - pad && lx > pad) { lx = pad; row++; }
    legendRows.push({ ...item, x: lx, row });
    lx += iw + 8;
  }
  const legendH = showLegend ? (row + 1) * 20 + 8 : 0;
  const headerH = titleLines.length * 20 + subLines.length * 16 + 10;
  const height = pad + headerH + ch + legendH + pad;

  const canvas = document.createElement("canvas");
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  ctx.scale(scale, scale);
  ctx.fillStyle = css("--surface") || "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.textBaseline = "top";
  let y = pad;
  ctx.fillStyle = css("--text-strong") || "#111111";
  ctx.font = `600 15px ${font}`;
  for (const l of titleLines) { ctx.fillText(l, pad, y); y += 20; }
  ctx.fillStyle = css("--text-muted") || "#666666";
  ctx.font = `12px ${font}`;
  for (const l of subLines) { ctx.fillText(l, pad, y); y += 16; }
  y += 10;
  ctx.drawImage(image, pad + (width - pad * 2 - cw) / 2, y, cw, ch);
  y += ch + 8;
  if (showLegend) {
    ctx.font = `12px ${font}`;
    for (const it of legendRows) {
      const ry = y + it.row * 20;
      ctx.fillStyle = it.color;
      ctx.fillRect(it.x, ry + 2, 10, 10);
      ctx.fillStyle = css("--text") || "#222222";
      ctx.fillText(it.name, it.x + 16, ry);
    }
  }

  const blob = await new Promise<Blob | null>((ok) => canvas.toBlob(ok, "image/png"));
  if (!blob) return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${slug(spec.title)}.png`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------- frame
export default function ChartBlock({ spec }: { spec: ChartSpec }) {
  const [ref, w] = useWidth();
  const figRef = useRef<HTMLElement>(null);
  const [asTable, setAsTable] = useState(false);
  const multi = spec.series.length > 1;
  const donutOk = spec.type === "pie" && !multi && spec.categories.length <= 6;

  const tableRows = [
    [spec.categoryAxis ?? "", ...spec.series.map((s) => s.name)],
    ...spec.categories.map((c, i) => [c, ...spec.series.map((s) => full(s.values[i], spec.unit))]),
  ];

  return (
    <figure ref={figRef} className="my-2 not-prose w-full border border-border rounded-lg bg-surface px-3.5 py-3 m-0 whitespace-normal print:break-inside-avoid">
      <style>{brokerPaletteCss()}</style>
      <figcaption className="flex items-start gap-3 mb-2">
        <div className="flex-1 min-w-0">
          <div className="font-display text-[14px] font-semibold text-text-strong leading-snug">{spec.title}</div>
          {spec.subtitle && <div className="text-[11.5px] text-text-muted mt-0.5">{spec.subtitle}</div>}
        </div>
        <div className="shrink-0 flex gap-1.5 print:hidden">
          {!asTable && (
            <button
              type="button"
              onClick={() => void downloadPng(figRef.current, spec)}
              aria-label="Download chart as PNG"
              className="px-2 py-0.5 rounded border border-border text-[11px] font-semibold text-text hover:bg-surface-alt cursor-pointer"
            >
              PNG
            </button>
          )}
          <button
            type="button"
            onClick={() => setAsTable((t) => !t)}
            className="px-2 py-0.5 rounded border border-border text-[11px] font-semibold text-text hover:bg-surface-alt cursor-pointer"
          >
            {asTable ? "Chart" : "Table"}
          </button>
        </div>
      </figcaption>

      <div ref={ref}>
        {asTable ? (
          <ChatTable rows={tableRows} />
        ) : spec.type === "pie" ? (
          donutOk ? <Donut spec={spec} /> : multi ? <ColumnChart spec={spec} w={w} kind="bar" /> : <HorizontalBars spec={spec} w={w} showShare />
        ) : spec.type === "horizontal_bar" && !multi ? (
          <HorizontalBars spec={spec} w={w} />
        ) : (
          <ColumnChart
            spec={spec}
            w={w}
            kind={spec.type === "stacked_bar" ? "stacked" : spec.type === "percent_stacked_bar" ? "percent" : spec.type === "line" ? "line" : "bar"}
          />
        )}
      </div>

      {multi && !asTable && spec.type !== "pie" && (
        <ul className="m-0 mt-2 p-0 list-none flex flex-wrap gap-x-4 gap-y-1 text-[12px]" aria-label="Legend">
          {spec.series.map((s, i) => (
            <li key={s.name} className="flex items-center gap-1.5 text-text">
              <span aria-hidden className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: seriesColor(s.name, i) }} />
              {s.name}
            </li>
          ))}
        </ul>
      )}
    </figure>
  );
}
