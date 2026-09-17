"use client";

import type { BulletinRow, BulletinSection, BulletinTable, MarketBulletin, MonthlyComparison, MonthlySaleSlot, PriceRange } from "@/types/api";
import type { CSSProperties } from "react";
import { Fragment, useLayoutEffect, useRef, useState } from "react";
import styles from "./MarketBulletinBulletin.module.css";

/** A page's own vertical sizing knobs — every value here maps straight onto a `--mb-*` CSS
 *  custom property that MarketBulletinBulletin.module.css consumes via `var()`. Nothing here
 *  touches horizontal layout (grid columns, card widths, section grouping) at all — those stay
 *  exactly as designed regardless of density, per "shrink without affecting the structure."
 *  Only the numbers that determine how TALL a page's content is are density-scaled.
 *
 *  Page 4's pie donuts (donutSize/donutGap) used to live here too, but per the user's own
 *  instruction to make them much bigger for legibility, they're now a plain fixed size in the
 *  CSS (.donutSvg/.donutRow) instead — tying their size to whichever rung pages 1-3 need would
 *  have meant page 4 (which has its own dedicated page and plenty of spare height) staying small
 *  just because Dust or another page-1-3 section needed a tighter rung. */
interface MbDensity {
  rowH: number;
  rowFs: number;
  theadH: number;
  theadFs: number;
  theadUnitFs: number;
  colheadFs: number;
  colheadPadV: number;
  sectionHeadFs: number;
  sectionHeadPadT: number;
  sectionHeadPadB: number;
  tgridPad: number;
  sectionsGap: number;
  pageGap: number;
  pagePadV: number;
  pagePadH: number;
}

/** Three fixed steps rather than a continuous solve (unlike Top Price Page's own
 *  planTppBulletinAutoFit): every table here has a FIXED row count by construction per section
 *  (4 rows for a flat tier table, 10 for High and Medium's elevation-banded grade tables, 12 for
 *  Dust's — see this file's own PAGE_GROUPS comment), so — unlike TPP's genuinely data-driven
 *  row counts — there's no need for TPP's per-region column-reflow math, just "does the fixed
 *  shape fit at this size." Tried largest (best legibility) to smallest first; the first one
 *  where every page's real rendered height fits its physical sheet wins. COZY is today's own
 *  hand-measured, known-to-fit-with-margin size —
 *  ROOMY is a modest step up for a future sale with slightly less content than today's, and
 *  COMPACT is a real safety net for the opposite: more grade codes, longer numbers, or any other
 *  future data drift that pushes a page's fixed shape past what COZY can hold. */
const MB_ROOMY: MbDensity = {
  rowH: 15,
  rowFs: 11,
  theadH: 22,
  theadFs: 15.5,
  theadUnitFs: 8.5,
  colheadFs: 8.5,
  colheadPadV: 1.5,
  sectionHeadFs: 13.5,
  sectionHeadPadT: 3.5,
  sectionHeadPadB: 4.5,
  tgridPad: 3.5,
  sectionsGap: 5.5,
  pageGap: 5.5,
  pagePadV: 9.5,
  pagePadH: 13.5,
};
const MB_COZY: MbDensity = {
  rowH: 14,
  rowFs: 10.5,
  theadH: 21,
  theadFs: 15,
  theadUnitFs: 8,
  colheadFs: 8,
  colheadPadV: 1,
  sectionHeadFs: 13,
  sectionHeadPadT: 3,
  sectionHeadPadB: 4,
  tgridPad: 3,
  sectionsGap: 5,
  pageGap: 5,
  pagePadV: 9,
  pagePadH: 13,
};
const MB_COMPACT: MbDensity = {
  rowH: 12,
  rowFs: 9.5,
  theadH: 18,
  theadFs: 13,
  theadUnitFs: 7,
  colheadFs: 7,
  colheadPadV: 0.5,
  sectionHeadFs: 11.5,
  sectionHeadPadT: 2,
  sectionHeadPadB: 3,
  tgridPad: 2,
  sectionsGap: 4,
  pageGap: 4,
  pagePadV: 7,
  pagePadH: 11,
};
const MB_DENSITY_LADDER: MbDensity[] = [MB_ROOMY, MB_COZY, MB_COMPACT];

function densityToCssVars(d: MbDensity): CSSProperties {
  return {
    "--mb-row-h": `${d.rowH}px`,
    "--mb-row-fs": `${d.rowFs}px`,
    "--mb-thead-h": `${d.theadH}px`,
    "--mb-thead-fs": `${d.theadFs}px`,
    "--mb-thead-unit-fs": `${d.theadUnitFs}px`,
    "--mb-colhead-fs": `${d.colheadFs}px`,
    "--mb-colhead-pad-v": `${d.colheadPadV}px`,
    "--mb-sectionhead-fs": `${d.sectionHeadFs}px`,
    "--mb-sectionhead-pad-t": `${d.sectionHeadPadT}px`,
    "--mb-sectionhead-pad-b": `${d.sectionHeadPadB}px`,
    "--mb-tgrid-pad": `${d.tgridPad}px`,
    "--mb-sections-gap": `${d.sectionsGap}px`,
    "--mb-page-gap": `${d.pageGap}px`,
    "--mb-page-pad-v": `${d.pagePadV}px`,
    "--mb-page-pad-h": `${d.pagePadH}px`,
  } as CSSProperties;
}

/** True whenever ANY rendered page has grown past one physical A4-landscape sheet — `.page`'s
 *  `min-height: 210mm` means it only ever grows past that if its content genuinely doesn't fit,
 *  so comparing the page's own measured width (which IS fixed at 297mm) against its height is a
 *  direct, live read of real overflow rather than a JS estimate of it (unlike Top Price Page,
 *  which needs a pure-JS formula because it also feeds a separate Excel exporter — this report
 *  has no second consumer, so measuring the actual DOM is simpler and can't drift out of sync
 *  with what actually renders). 0.5px epsilon absorbs sub-pixel layout rounding. */
function anyPageOverflows(root: HTMLElement): boolean {
  const pages = root.querySelectorAll<HTMLElement>("[data-mb-page]");
  for (const page of pages) {
    const rect = page.getBoundingClientRect();
    if (rect.width <= 0) continue;
    const pxPerMm = rect.width / 297;
    if (rect.height > pxPerMm * 210 + 0.5) return true;
  }
  return false;
}

/** Every table in this bulletin has a FIXED row count by construction (a 4-tier table always
 *  has exactly 4 rows, a 2-tier table always 2, etc. — how many lots actually exist only
 *  changes the numbers inside, never the shape). Confirmed against two real sales a year apart
 *  (Sale 51/2024, Sale 33/2026): identical table/row counts in every section. That means, unlike
 *  Top Price Page's ranked-lot rows (which genuinely vary sale to sale and need a runtime
 *  density solver with per-region column-reflow math), this bulletin's SHAPE (which sections/
 *  tables/rows exist) never varies with data — only the numbers inside do. It still gets its own
 *  runtime auto-fit (see MB_DENSITY_LADDER/anyPageOverflows below), just a much simpler one: a
 *  small ladder of discrete sizes tried largest-to-smallest, measuring the real rendered page
 *  height rather than solving a layout from scratch, so any future data drift (a new grade code,
 *  a longer number) still always fits rather than relying on today's shape holding forever.
 *
 *  Page grouping is fixed at exactly 3 pages, in the user's own stated section order (Low Grown,
 *  Premium Flowery, Off Grade, Dust, High and Medium, Unorthodox, Ex-estate) — "without changing
 *  the place" — rather than however many pages the content would naturally spread across. High
 *  and Medium alone (15 grades × 10-row tables) is by far the biggest section the report has
 *  ever carried, so fitting it onto page 3 relies on packing it at a narrow per-card width (see
 *  SECTION_MIN_WIDTH) plus the density ladder's own COMPACT rung — verify visually after any
 *  future data drift that adds rows/grades, since 3 pages is now a hard requirement, not just
 *  whatever the auto-fit ladder happens to produce.
 *  Every page's real leftover space is filled edge to edge by pure CSS, not JS: every grade-table
 *  section stays compact (hugs its own content — see `.section`'s own CSS comment for why this
 *  changed from an earlier per-section flex-grow split), and `.sections`' own
 *  `justify-content: space-evenly` spreads ALL of a page's leftover height as even margins/gaps
 *  around every section uniformly. Exact by construction either way, not measured or tuned to
 *  today's numbers specifically. */
const PAGE_GROUPS: { sections: string[] }[] = [
  { sections: ["Low Grown", "Premium Flowery"] },
  { sections: ["Off Grade", "Dust", "Unorthodox"] },
  { sections: ["High and Medium", "Ex-estate"] },
];

/** Minimum card width per section, used with `repeat(auto-fill, minmax(w, 1fr))` so the grid
 *  itself decides how many cards fit per row and every row of cards stays equal-width — no
 *  manual column count, and no stretched trailing card. The previous approach (a fixed column
 *  count + spanning the last card across whatever columns were left over) produced a visibly
 *  oversized, out-of-place table whenever a section's table count didn't divide evenly (e.g.
 *  Low Grown's 13th table, BOPF, stretching across the full page width while every other card
 *  sat at a third of that). auto-fill instead leaves a normal trailing gap on a short last row,
 *  which reads as an ordinary card grid rather than a layout bug.
 *
 *  Narrowed again, uniformly, per the user's own instruction: ~255px fits 4 cards per row at the
 *  real 10px column-gap (see .tableGroupGrid's own CSS comment) across every section rather than
 *  the previous 2-3 — verify visually if grade text ever needs to wrap.
 *
 *  Dust was the one exception, widened up from 255 for its longer elevation-prefixed labels
 *  ("Medium Select Best", "High Below Best") — confirmed by measuring real rendered label/value
 *  overflow against actual sale data (a placeholder-only "NA" sale never overflows and hid this
 *  the first time).
 *
 *  Widened again, across every section this time, for the quantity-% column added per the
 *  user's own instruction (see PriceRange.quantityPct's own doc comment and .rowValGroup/.rowPct
 *  in the CSS) — two extra narrow columns (this week's % and last week's) push every section's
 *  real minimum width up, not just Dust's, so the per-row-count win from the earlier "fit 4 per
 *  row" pass is partly given back here; re-verified against real sale data after adding the %
 *  columns, not re-derived from theory alone. */
const SECTION_MIN_WIDTH: Record<string, number> = {
  "Low Grown": 300,
  "Premium Flowery": 300,
  "Off Grade": 300,
  Dust: 350,
  "High and Medium": 300,
  Unorthodox: 300,
  "Ex-estate": 300,
};

/** A row's label always tells you which merged tier(s) it is (see MarketBulletinEngine.cs's
 *  BuildRow calls): every "Best"/"Brighter" row merges Select Best + Best, every "Other"/
 *  "Poor"/"Others" row merges Below Best + Poor, and "Select Best" alone is the top 15%. Color
 *  accents per tier were dropped per the user's own instruction (too busy against the rest of
 *  the bulletin); this is now only used to add a small gap where the tier changes from one row
 *  to the next (see tierBreak in TableCard/.row[data-tier-break] in the CSS), so quality groups
 *  still read as distinct without any color. */
function tierAccent(label: string): "top" | "poor" | "neutral" {
  // Dust's rows are elevation-prefixed ("Low Select Best", "High Poor") — strip a leading
  // "Low "/"Medium "/"High " band prefix before checking, so those rows get the same accent
  // as every other section's plain "Select Best"/"Poor" rows instead of falling through to
  // "neutral" just because of the elevation label in front.
  const core = /^(?:Low|Medium|High)\s(.+)$/.exec(label)?.[1] ?? label;
  if (core === "Select Best" || core.startsWith("Best") || core.startsWith("Brighter")) return "top";
  if (core === "Poor" || core === "Others" || core.startsWith("Other")) return "poor";
  return "neutral";
}

function extractSaleNumber(sourceName: string): string {
  const m = /Sale\s+(\d+)/i.exec(sourceName);
  return m ? m[1] : sourceName;
}

function formatRange(r: PriceRange): string {
  if (r.lotCount === 0 || r.min === null || r.max === null) return "NA";
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
  return r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;
}

/** The tier's share of the grade's total traded quantity (Kg) that week — see
 *  PriceRange.quantityPct's own doc comment for what null vs. a real 0-100 value means. */
function formatPct(pct: number | null): string {
  return pct === null ? "—" : `${pct.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`;
}

/** Dust's rows are elevation-prefixed ("Low Select Best" … "High Poor", 12 rows per table) — this
 *  pulls just that "Low"/"Medium"/"High" prefix so TableCard can tell where one elevation band
 *  ends and the next begins. Every other section's plain labels ("Select Best", "Poor") have no
 *  such prefix and return null, so they never trigger a band break. */
function rowBand(label: string): string | null {
  return /^(Low|Medium|High)\s/.exec(label)?.[1] ?? null;
}

function RangeRow({ row, zebra, bandBreak, tierBreak }: { row: BulletinRow; zebra: boolean; bandBreak?: boolean; tierBreak?: boolean }) {
  return (
    <div
      className={styles.row}
      data-zebra={zebra ? "true" : "false"}
      data-band-break={bandBreak ? "true" : undefined}
      data-tier-break={tierBreak ? "true" : undefined}
    >
      <span className={styles.rowLabel} title={row.label}>
        {row.label}
      </span>
      <span className={styles.rowValGroup}>
        <span className={`${styles.rowVal} ${styles.rowValThis}`}>{formatRange(row.thisWeek)}</span>
        <span className={styles.rowPct} title="Share of this grade's total traded quantity this week">
          {formatPct(row.thisWeek.quantityPct)}
        </span>
      </span>
      <span className={styles.rowValGroup}>
        <span className={`${styles.rowVal} ${styles.rowValLast}`}>{formatRange(row.lastWeek)}</span>
        <span className={styles.rowPct} title="Share of this grade's total traded quantity last week">
          {formatPct(row.lastWeek.quantityPct)}
        </span>
      </span>
    </div>
  );
}

function TableCard({ table }: { table: BulletinTable }) {
  return (
    <div className={styles.table}>
      <div className={styles.tableHead}>
        <span>{table.gradeLabel}</span>
        <span className={styles.tableHeadUnit}>Rs/Kg</span>
      </div>
      <div className={styles.colHead}>
        <span>&nbsp;</span>
        <span className={styles.colHeadGroup}>
          <span className={styles.colHeadPrice}>This Week</span>
          <span className={styles.colHeadPct}>Qty%</span>
        </span>
        <span className={styles.colHeadGroup}>
          <span className={styles.colHeadPrice}>Last Week</span>
          <span className={styles.colHeadPct}>Qty%</span>
        </span>
      </div>
      {table.rows.map((r, i) => {
        const band = rowBand(r.label);
        const bandBreak = i > 0 && band !== null && band !== rowBand(table.rows[i - 1].label);
        const tierBreak = i > 0 && tierAccent(r.label) !== tierAccent(table.rows[i - 1].label);
        return <RangeRow key={i} row={r} zebra={i % 2 === 1} bandBreak={bandBreak} tierBreak={tierBreak} />;
      })}
    </div>
  );
}

function SectionCard({ section }: { section: BulletinSection }) {
  const minWidth = SECTION_MIN_WIDTH[section.title] ?? 480;
  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>{section.title}</div>
      {section.tables.length === 0 ? (
        <div className={styles.sectionEmpty}>No matching lots for this section.</div>
      ) : (
        <div className={styles.tableGrid} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}>
          {section.tables.map((t, ti) => (
            <TableCard key={ti} table={t} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---- page 4: month-over-month sale comparison, one combined pie per sale ----------------------

/** Same quality-scale color language as the rest of the bulletin (gold = best, rust = worst —
 *  see tierAccent's own comment) extended to all four tiers at once, since here they're all
 *  shown simultaneously as one pie's wedges rather than picked out one row at a time. */
const TIER_ORDER = ["Select Best", "Best", "Below Best", "Poor"] as const;
const TIER_COLORS: Record<(typeof TIER_ORDER)[number], string> = {
  "Select Best": "#d9b44a",
  Best: "#2f7d52",
  "Below Best": "#5b7fa6",
  Poor: "#a24b3a",
};
const TIER_SHORT: Record<(typeof TIER_ORDER)[number], string> = {
  "Select Best": "S.Best",
  Best: "Best",
  "Below Best": "B.Best",
  Poor: "Poor",
};

/** One pie's four wedge values (quantity, in kg) — 0 for a missing tier so a sale with no data at
 *  all sums to 0 (rendered as a plain hollow placeholder circle by PieSlot, never a silently
 *  wrong-looking chart). Quantity is the one metric that's genuinely a share of one physical
 *  total, so it's the one that drives the wedges — price is shown as a min-max range in the
 *  table below each pie instead of a second pie (see PieSlot's own doc comment for why: real
 *  sale data showed a price-share pie barely changes shape week to week even when real Rs/kg
 *  prices swing several percent, because all four tiers move together). */
function tierQuantities(tiers: MonthlySaleSlot["tiers"]): number[] {
  if (!tiers) return [0, 0, 0, 0];
  return TIER_ORDER.map((name) => tiers.find((t) => t.tier === name)?.quantityKg ?? 0);
}

/** Min/max price among ASC's own lots in this tier, null when the tier had none — see
 *  MonthlyTierMetricsDto's own doc comment for why a range instead of a single averaged
 *  number. */
function tierPriceRange(tiers: MonthlySaleSlot["tiers"], tier: (typeof TIER_ORDER)[number]): { min: number; max: number } | null {
  const t = tiers?.find((t) => t.tier === tier);
  if (!t || t.minPrice === null || t.maxPrice === null) return null;
  return { min: t.minPrice, max: t.maxPrice };
}

function tierQty(tiers: MonthlySaleSlot["tiers"], tier: (typeof TIER_ORDER)[number]): number | null {
  return tiers?.find((t) => t.tier === tier)?.quantityKg ?? null;
}

function formatKg(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Left-aligned (see .pieLegendPrice's own CSS comment) per the user's own instruction: every
 *  row's range now starts at the exact same fixed position right after Kg, rather than each
 *  half separately right-aligned — which left the gap AFTER Kg (and after the dash) varying
 *  row to row depending on how many digits that particular min/max happened to have. */
function formatPriceRange(r: { min: number; max: number }): string {
  const fmt = (n: number) => Math.round(n).toLocaleString();
  return r.min === r.max ? fmt(r.min) : `${fmt(r.min)}–${fmt(r.max)}`;
}

const PIE_CX = 50;
const PIE_CY = 50;
const PIE_R = 44;

/** `radius` defaults to the wedge's own outer radius (for drawing the slice's arc points) — the
 *  label position below passes a smaller radius instead, so the percentage text sits INSIDE the
 *  wedge rather than out on its rim. */
function polarPoint(angleDeg: number, radius: number = PIE_R): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg sits at 12 o'clock
  return { x: PIE_CX + radius * Math.cos(rad), y: PIE_CY + radius * Math.sin(rad) };
}

/** Where a wedge's own percentage label sits — the midpoint angle of its sweep, at 62% of the
 *  pie's radius (visually centered within the wedge's own area, not its rim or its center point,
 *  since a wedge's true visual "middle" sits closer to the outer edge than the circle's own
 *  center once you account for how a pie slice's area is distributed). */
function pieLabelPos(midAngleDeg: number): { x: number; y: number } {
  return polarPoint(midAngleDeg, PIE_R * 0.62);
}

/** One sale's four tiers as an actual pie chart — a wedge per tier, sized by its share of the
 *  total, going clockwise from 12 o'clock in TIER_ORDER (Select Best first) — a literal pie
 *  chart per the user's own sketch, replacing this file's earlier ring and split-circle attempts.
 *  A single non-zero tier is drawn as a plain filled circle rather than a wedge: the general arc
 *  path degenerates to a zero-length arc when its own share is the full 360°, since the start and
 *  end points coincide. Returns null for an all-zero sale so the caller can draw an empty
 *  placeholder circle instead of a broken chart. Each slice also carries `pct` (its own share,
 *  0-100) and `labelPos` — per the user's own instruction to show the percentage inside the pie
 *  itself, not just inferred from wedge size. */
function pieSlices(
  values: number[]
): { tier: (typeof TIER_ORDER)[number]; d?: string; fullCircle?: boolean; pct: number; labelPos: { x: number; y: number } }[] | null {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 1) {
    const i = values.findIndex((v) => v > 0);
    return [{ tier: TIER_ORDER[i], fullCircle: true, pct: 100, labelPos: { x: PIE_CX, y: PIE_CY } }];
  }
  let angle = 0;
  const slices: { tier: (typeof TIER_ORDER)[number]; d: string; pct: number; labelPos: { x: number; y: number } }[] = [];
  values.forEach((v, i) => {
    if (v <= 0) return;
    const sweep = (v / total) * 360;
    const start = polarPoint(angle);
    const end = polarPoint(angle + sweep);
    const largeArc = sweep > 180 ? 1 : 0;
    slices.push({
      tier: TIER_ORDER[i],
      d: `M ${PIE_CX} ${PIE_CY} L ${start.x} ${start.y} A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${end.x} ${end.y} Z`,
      pct: Math.round((v / total) * 100),
      labelPos: pieLabelPos(angle + sweep / 2),
    });
    angle += sweep;
  });
  return slices;
}

/** One sale's combined chart: a pie whose wedges are each tier's share of the sale's total kg,
 *  plus a compact table underneath listing each tier's actual quantity AND average price as real
 *  numbers — one card per ordinal sale slot, within whichever row (Last Month / This Month) it
 *  belongs to. The table sits BELOW the pie (spanning its width) rather than beside it, so a
 *  card's footprint stays close to the pie's own diameter — beside-the-pie was tried first, but
 *  doubling every card's width left only 3 fitting per row instead of 4-5, which is what "fit to
 *  the page" is actually asking for. Two separate pies (quantity share AND price share) were
 *  tried even earlier; dropped once real sale data showed the price-share pie stays visually
 *  identical week to week regardless of real price movement (see tierQuantities' own doc
 *  comment) — the wedges carry quantity, the table carries both real numbers per tier. `slot` is
 *  undefined either when that ordinal position doesn't exist for this side (e.g. last month only
 *  had 4 sales, this month has a 5th) or when this month hasn't reached that sale yet as of the
 *  sale currently being viewed (MarketBulletinMonthlyEngine's own "as of this sale" cutoff) —
 *  both render as a hollow circle with dashed table rows, per the user's own sketch showing
 *  not-yet-happened weeks as empty outlines, rather than a gap that could read as a layout bug. */
function PieSlot({ slot }: { slot?: MonthlySaleSlot }) {
  const slices = pieSlices(tierQuantities(slot?.tiers ?? null));
  return (
    <div className={styles.donutCard}>
      <svg viewBox={`0 0 ${PIE_CX * 2} ${PIE_CY * 2}`} className={styles.donutSvg} aria-hidden="true">
        {slices ? (
          <>
            {slices.map((s) =>
              s.fullCircle ? (
                <circle key={s.tier} cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill={TIER_COLORS[s.tier]} stroke="#fff" strokeWidth={1} />
              ) : (
                <path key={s.tier} d={s.d} fill={TIER_COLORS[s.tier]} stroke="#fff" strokeWidth={1} />
              ),
            )}
            {/* Percentage labels inside each wedge, per the user's own instruction — a separate
                pass over the same slices, drawn AFTER every wedge/circle so no label ever sits
                underneath a later slice's fill. */}
            {slices.map((s) => (
              <text
                key={`${s.tier}-pct`}
                x={s.labelPos.x}
                y={s.labelPos.y}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize={7.5}
                fontWeight={700}
                fill="#fff"
                stroke="rgba(0,0,0,0.35)"
                strokeWidth={0.4}
                paintOrder="stroke"
              >
                {s.pct}%
              </text>
            ))}
          </>
        ) : (
          <circle cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill="none" stroke="#c9c4b0" strokeWidth={2} />
        )}
      </svg>
      <div className={slices ? styles.donutLabelThis : styles.donutLabelPending} title={slot?.sourceName ?? undefined}>
        {slot?.sourceName ?? "Not yet"}
      </div>
      {/* One shared CSS Grid for the header AND every tier row (rather than each row being its
          own separate grid, stacked by the outer flex column) — per the user's own instruction:
          a `border-left` on each row's own cell only ever draws a short segment for that row's
          own height, so stacking rows with any gap between them reads as a broken, dashed line
          rather than one continuous rule. Two dedicated 1px "gutter" columns (positioned via
          gridColumn 3 and 5 below) hold the actual divider lines, each spanning every row at
          once via `gridRow: "1 / 6"` (1 header + 4 tiers = 6 line boundaries), so it's genuinely
          ONE unbroken line regardless of how many rows sit between its two ends. Every real cell
          gets an explicit gridColumn/gridRow instead of relying on auto-placement, since
          auto-placement has no way to know it should skip over the two gutter columns. */}
      <div className={styles.pieLegendTable}>
        <span className={styles.pieLegendHeadCell} style={{ gridColumn: 4, gridRow: 1 }}>
          Kg
        </span>
        <span className={styles.pieLegendHeadCellLeft} style={{ gridColumn: 6, gridRow: 1 }}>
          Rs/Kg
        </span>
        {TIER_ORDER.map((tier, i) => {
          const row = i + 2;
          const qty = tierQty(slot?.tiers ?? null, tier);
          const priceRange = tierPriceRange(slot?.tiers ?? null, tier);
          return (
            <Fragment key={tier}>
              <span
                className={styles.pieLegendSwatch}
                style={{ gridColumn: 1, gridRow: row, background: TIER_COLORS[tier] }}
                aria-hidden="true"
              />
              <span className={styles.pieLegendTier} style={{ gridColumn: 2, gridRow: row }}>
                {TIER_SHORT[tier]}
              </span>
              <span className={styles.pieLegendQty} style={{ gridColumn: 4, gridRow: row }}>
                {qty !== null ? formatKg(qty) : "—"}
              </span>
              <span className={styles.pieLegendPrice} style={{ gridColumn: 6, gridRow: row }}>
                {priceRange !== null ? formatPriceRange(priceRange) : "—"}
              </span>
            </Fragment>
          );
        })}
        <span className={styles.pieLegendVLine} style={{ gridColumn: 3, gridRow: "1 / 6" }} aria-hidden="true" />
        <span className={styles.pieLegendVLine} style={{ gridColumn: 5, gridRow: "1 / 6" }} aria-hidden="true" />
      </div>
    </div>
  );
}

/** One month's row of pie slots — "Last Month"/"This Month" are two separate, clearly labeled
 *  groups (per the user's own sketch) rather than fused into one chart per ordinal position, so
 *  the two months read as two plain rows stacked vertically. Each row renders exactly its OWN
 *  `slots.length` circles — a 4-sale month shows 4, a 5-sale month shows 5 — rather than padding
 *  the shorter row to match the other side's count: a 4-sale month sitting next to a 5-sale one
 *  doesn't need (and shouldn't show) a 5th empty placeholder circle just to line up column
 *  counts, since the two rows aren't meant to align slot-for-slot visually, just to be read as
 *  two independent calendars. */
function MonthlySaleRow({ heading, monthLabel, slots }: { heading: string; monthLabel: string; slots: MonthlySaleSlot[] }) {
  return (
    <div className={styles.pieRowGroup}>
      <div className={styles.pieRowLabel}>
        {heading} <span className={styles.pieRowLabelSub}>{monthLabel}</span>
      </div>
      <div className={styles.donutRow}>
        {slots.map((slot, i) => (
          <PieSlot key={i} slot={slot} />
        ))}
      </div>
    </div>
  );
}

/** The whole month-over-month comparison — one section, 8 (or up to 10, in a 5-sale month) pie
 *  cards total rather than a separate quantity section and a separate price section duplicating
 *  every card. Reuses the exact .section/.sectionHead styling pages 1-3 use for their grade
 *  tables, so page 4 fits the same visual language and the same page-filling flex-grow/
 *  space-evenly mechanism (see .section's own CSS comment) without needing a parallel layout
 *  system. */
function MonthlyComparisonSection({ comparison }: { comparison: MonthlyComparison }) {
  return (
    <div className={styles.section} data-mb-flow="grow">
      <div className={styles.sectionHead}>
        Month-to-Month Comparison of Quality <span className={styles.monthlyUnit}>wedge = Kg share per tier</span>
      </div>
      <div className={styles.monthlyBody}>
        <div className={styles.monthlyLegend}>
          {TIER_ORDER.map((t) => (
            <span key={t} className={styles.legendItem}>
              <span className={styles.legendSwatch} style={{ background: TIER_COLORS[t] }} aria-hidden="true" />
              {t}
            </span>
          ))}
        </div>
        <MonthlySaleRow heading="Last Month" monthLabel={comparison.lastMonthLabel} slots={comparison.lastMonth} />
        <MonthlySaleRow heading="This Month" monthLabel={comparison.thisMonthLabel} slots={comparison.thisMonth} />
      </div>
    </div>
  );
}

/** Masthead/footer are identical across every page (grade tables AND the monthly-pie page
 *  alike) except the page number itself and, on page 4, the subtitle — pulled out once both
 *  pages 1-3's own PAGE_GROUPS.map and page 4 need to render them, rather than a fourth
 *  copy-pasted inline block. `subtitle` defaults to pages 1-3's own title since page 4 is the
 *  only caller that overrides it: page 4 isn't a classification/quotation table at all, so
 *  keeping that subtitle there read as wrong once the reader actually looked at the page. */
function Masthead({
  bulletin,
  saleNo,
  prevSaleNo,
  subtitle = "Weekly Market Grade Classification/Quotation",
}: {
  bulletin: MarketBulletin;
  saleNo: string;
  prevSaleNo: string | null;
  subtitle?: string;
}) {
  return (
    <div className={styles.masthead}>
      <dl className={styles.mastheadMeta}>
        <div>
          <dt>Sale Date</dt>
          <dd>{bulletin.sourceName}</dd>
        </div>
      </dl>
      <div>
        <div className={styles.mastheadTitle}>Asia Siyaka Commodities PLC</div>
        <span className={styles.mastheadSub}>{subtitle}</span>
      </div>
      <div className={styles.mastheadRight}>
        <div>Sale No. {saleNo}</div>
        {prevSaleNo && <div className={styles.mastheadRightSub}>cf. Sale {prevSaleNo}</div>}
      </div>
    </div>
  );
}

function Footer({ saleNo, pageNumber, totalPages }: { saleNo: string; pageNumber: number; totalPages: number }) {
  return (
    <div className={styles.footer}>
      <span className={styles.footerRule} aria-hidden="true" />
      <span className={styles.footerCaption}>
        &#9670; {["Asia Siyaka Commodities PLC", `Sale No. ${saleNo}`, `Page ${pageNumber} of ${totalPages}`].join("   ·   ")} &#9670;
      </span>
      <span className={styles.footerRule} aria-hidden="true" />
    </div>
  );
}

export interface MarketBulletinBulletinProps {
  bulletin: MarketBulletin;
  /** Month-over-month quantity/average-price comparison for the 4th page — optional and fetched
   *  independently of the sale-specific bulletin data, so pages 1-3 still render correctly, just
   *  without a 4th page, if this hasn't loaded yet, the fetch fails, or the sale's SourceName
   *  doesn't parse into a month (MarketBulletinMonthlyEngine's own null case). */
  monthly?: MonthlyComparison | null;
  /** Fires once the density auto-fit has settled on a final size — the print route waits on
   *  this (rather than just "data has loaded") before telling Playwright the page is ready to
   *  snapshot, so a PDF export can never capture a mid-measurement frame. */
  onReady?: () => void;
}

function MarketBulletinBulletinContent({ bulletin, monthly, onReady }: MarketBulletinBulletinProps) {
  const byTitle = new Map(bulletin.sections.map((s) => [s.title, s]));
  const saleNo = extractSaleNumber(bulletin.sourceName);
  const prevSaleNo = bulletin.previousSourceName ? extractSaleNumber(bulletin.previousSourceName) : null;
  const totalPages = PAGE_GROUPS.length + (monthly ? 1 : 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const [rung, setRung] = useState(0);
  const [settled, setSettled] = useState(false);

  // Runs synchronously after each render, before the browser paints — measuring here (rather
  // than in a plain useEffect) is what keeps a downgrade from ROOMY invisible: React commits the
  // rung change and re-renders before anything is shown, so real overflow never flashes on
  // screen first. Settles on the first (most spacious) rung that fits, or COMPACT outright if
  // even that overflows — the same "never lose data, just use however many pages it genuinely
  // needs" philosophy as Top Price Page's own solver, rather than shrinking type past legibility.
  // onReady fires once settled, so a PDF snapshot can never catch a mid-measurement frame.
  useLayoutEffect(() => {
    if (settled) return;
    const root = rootRef.current;
    if (!root) return;
    if (anyPageOverflows(root) && rung < MB_DENSITY_LADDER.length - 1) {
      setRung((r) => r + 1);
    } else {
      setSettled(true);
      onReady?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rung, settled, bulletin]);

  const density = MB_DENSITY_LADDER[rung];

  return (
    <div className={styles.bulletin} ref={rootRef} style={densityToCssVars(density)}>
      {PAGE_GROUPS.map((group, pi) => {
        const sections = group.sections.map((t) => byTitle.get(t)).filter((s): s is BulletinSection => Boolean(s));
        if (sections.length === 0) return null;
        return (
          <div key={pi} className={styles.page} data-mb-page="true">
            <Masthead bulletin={bulletin} saleNo={saleNo} prevSaleNo={prevSaleNo} />
            <div className={styles.sections}>
              {sections.map((s, si) => (
                <SectionCard key={si} section={s} />
              ))}
            </div>
            <Footer saleNo={saleNo} pageNumber={pi + 1} totalPages={totalPages} />
          </div>
        );
      })}

      {/* Page 4 — month-over-month sale comparison, a deliberately different concept from pages
          1-3's per-grade tables: Asia Siyaka's own book (not a market-wide snapshot — see
          MarketBulletinMonthlyEngine's own doc comment), two rows of pie charts — Last Month's
          sales above, This Month's below, one combined pie per ordinal sale position (wedges =
          quantity share, table underneath = real Kg and Rs/kg per tier). Its own masthead
          subtitle (not "...Classification/Quotation" — this page shows neither) and a
          full-height section (data-mb-flow="grow" — see .section's own CSS comment; pages 1-3's
          grade sections no longer use this, but page 4 has only one section, so stretching it is
          still exactly right) so it fills the page edge to edge rather than floating centered
          with empty bands above and below it. Rendered only once monthly data has actually
          loaded — see
          MarketBulletinBulletinProps' own doc comment on why this degrades to "just 3 pages"
          rather than a broken 4th page when it hasn't (or the sale's own name doesn't parse into
          a month at all). */}
      {monthly && (
        <div className={styles.page} data-mb-page="true">
          <Masthead bulletin={bulletin} saleNo={saleNo} prevSaleNo={prevSaleNo} subtitle="Monthly Sale Comparison" />
          <div className={styles.sections}>
            <MonthlyComparisonSection comparison={monthly} />
          </div>
          <Footer saleNo={saleNo} pageNumber={totalPages} totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}

export default function MarketBulletinBulletin(props: MarketBulletinBulletinProps) {
  // A new monthly payload changes the number of pages. Remounting the solver gives it a clean
  // density state without synchronously resetting state from an effect after the old layout has
  // already rendered.
  const inputKey = `${props.bulletin.sourceName}:${props.monthly ? "monthly" : "pending"}`;
  return <MarketBulletinBulletinContent key={inputKey} {...props} />;
}
