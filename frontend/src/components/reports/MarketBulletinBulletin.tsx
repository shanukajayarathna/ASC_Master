"use client";

import type { BulletinRow, BulletinSection, BulletinTable, MarketBulletin, MonthlyComparison, MonthlySaleSlot, PriceRange } from "@/types/api";
import type { CSSProperties } from "react";
import { useLayoutEffect, useRef, useState } from "react";
import styles from "./MarketBulletinBulletin.module.css";

/** A page's own vertical sizing knobs — every value here maps straight onto a `--mb-*` CSS
 *  custom property that MarketBulletinBulletin.module.css consumes via `var()`. Nothing here
 *  touches horizontal layout (grid columns, card widths, section grouping) at all — those stay
 *  exactly as designed regardless of density, per "shrink without affecting the structure."
 *  Only the numbers that determine how TALL a page's content is are density-scaled. */
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
  tgridGap: number;
  tgridPad: number;
  sectionsGap: number;
  pageGap: number;
  pagePadV: number;
  pagePadH: number;
  deltaH: number;
  deltaFs: number;
  donutSize: number;
  donutGap: number;
}

/** Three fixed steps rather than a continuous solve (unlike Top Price Page's own
 *  planTppBulletinAutoFit): every table here has a FIXED row count by construction (a 4-tier
 *  table always has exactly 4 rows — see this file's own PAGE_GROUPS comment), so — unlike TPP's
 *  genuinely data-driven row counts — there's no need for TPP's per-region column-reflow math,
 *  just "does the fixed shape fit at this size." Tried largest (best legibility) to smallest
 *  first; the first one where every page's real rendered height fits its physical sheet wins.
 *  COZY is today's own hand-measured, known-to-fit-with-margin size (see PAGE_GROUPS's doc
 *  comment: H&M Orthodox+Off Grades+Dust together measured at 175.6mm of a 185.3mm budget) —
 *  ROOMY is a modest step up for a future sale with slightly less content than today's, and
 *  COMPACT is a real safety net for the opposite: more grade codes, longer numbers, or any other
 *  future data drift that pushes a page's fixed shape past what COZY can hold. */
const MB_ROOMY: MbDensity = {
  rowH: 15,
  rowFs: 11,
  theadH: 17,
  theadFs: 11.5,
  theadUnitFs: 9,
  colheadFs: 8.5,
  colheadPadV: 1.5,
  sectionHeadFs: 13.5,
  sectionHeadPadT: 3.5,
  sectionHeadPadB: 4.5,
  tgridGap: 3.5,
  tgridPad: 3.5,
  sectionsGap: 5.5,
  pageGap: 5.5,
  pagePadV: 9.5,
  pagePadH: 13.5,
  deltaH: 12,
  deltaFs: 8.5,
  donutSize: 152,
  donutGap: 22,
};
const MB_COZY: MbDensity = {
  rowH: 14,
  rowFs: 10.5,
  theadH: 16,
  theadFs: 11,
  theadUnitFs: 8.5,
  colheadFs: 8,
  colheadPadV: 1,
  sectionHeadFs: 13,
  sectionHeadPadT: 3,
  sectionHeadPadB: 4,
  tgridGap: 3,
  tgridPad: 3,
  sectionsGap: 5,
  pageGap: 5,
  pagePadV: 9,
  pagePadH: 13,
  deltaH: 11,
  deltaFs: 8,
  donutSize: 132,
  donutGap: 18,
};
const MB_COMPACT: MbDensity = {
  rowH: 12,
  rowFs: 9.5,
  theadH: 14,
  theadFs: 10,
  theadUnitFs: 7.5,
  colheadFs: 7,
  colheadPadV: 0.5,
  sectionHeadFs: 11.5,
  sectionHeadPadT: 2,
  sectionHeadPadB: 3,
  tgridGap: 2,
  tgridPad: 2,
  sectionsGap: 4,
  pageGap: 4,
  pagePadV: 7,
  pagePadH: 11,
  deltaH: 10,
  deltaFs: 7.5,
  donutSize: 100,
  donutGap: 14,
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
    "--mb-tgrid-gap": `${d.tgridGap}px`,
    "--mb-tgrid-pad": `${d.tgridPad}px`,
    "--mb-sections-gap": `${d.sectionsGap}px`,
    "--mb-page-gap": `${d.pageGap}px`,
    "--mb-page-pad-v": `${d.pagePadV}px`,
    "--mb-page-pad-h": `${d.pagePadH}px`,
    "--mb-delta-h": `${d.deltaH}px`,
    "--mb-delta-fs": `${d.deltaFs}px`,
    "--mb-donut-size": `${d.donutSize}px`,
    "--mb-donut-gap": `${d.donutGap}px`,
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
 *  3 pages, not 2 — a deliberate trade-off for real, comfortably-readable text size rather than
 *  forcing 2 pages and shrinking type back down to fit. Grouped in the SAME order the printed
 *  bulletin itself uses — High Grown, Medium Grown & Unorthodox together; H&M Orthodox Black
 *  Tea, Off Grades & Dust together; Low Grown alone — rather than a balance-optimized grouping,
 *  even though that leaves page 1 with real leftover space under its own (lighter) content.
 *  Getting Dust onto the same page as H&M Orthodox and Off Grades (matching the original) doesn't
 *  fit at the previous, larger type size — those three alone need ~215mm against a page's
 *  ~184.5mm budget — so row height, table-head height and most font sizes were trimmed by
 *  roughly 15% specifically to make this grouping fit in 3 pages without spilling to a 4th.
 *  Every page's real leftover space (there's always some — the 7 sections don't split evenly
 *  into exactly 3 full sheets) is filled edge to edge by pure CSS, not JS, split two ways: a
 *  MULTI-row section (isMultiRowSection below — H&M Orthodox/Off Grades/Dust/Low Grown) claims
 *  its own fair share via `flex: 1 1 auto` and spreads it BETWEEN its own rows of tables
 *  (`.tableGrid`'s `align-content: space-evenly`); a single-row section (High Grown/Medium
 *  Grown/Unorthodox, always exactly one row of 2 cards) stays compact instead — stretching a
 *  lone row just centers it with a big dead band above and below, reading as unfinished rather
 *  than spacious — and leaves its share for `.sections`' own `justify-content: space-evenly` to
 *  spread as even margins/gaps around the compact cards. Both are exact by construction, and
 *  neither is measured or tuned to today's numbers specifically. */
const PAGE_GROUPS: { sections: string[] }[] = [
  { sections: ["High Grown", "Medium Grown", "Unorthodox"] },
  { sections: ["H&M Orthodox Black Tea", "Off Grades", "Dust"] },
  { sections: ["Low Grown"] },
];

/** Minimum card width per section, used with `repeat(auto-fill, minmax(w, 1fr))` so the grid
 *  itself decides how many cards fit per row and every row of cards stays equal-width — no
 *  manual column count, and no stretched trailing card. The previous approach (a fixed column
 *  count + spanning the last card across whatever columns were left over) produced a visibly
 *  oversized, out-of-place table whenever a section's table count didn't divide evenly (e.g.
 *  Low Grown's 13th table, BOPF, stretching across the full page width while every other card
 *  sat at a third of that). auto-fill instead leaves a normal trailing gap on a short last row,
 *  which reads as an ordinary card grid rather than a layout bug. Off Grades/Dust use a wider
 *  minimum so their Better/Other pair still lands two-per-row rather than tipping to three. */
const SECTION_MIN_WIDTH: Record<string, number> = {
  "High Grown": 480,
  "Medium Grown": 480,
  Unorthodox: 480,
  "H&M Orthodox Black Tea": 330,
  "Off Grades": 480,
  Dust: 480,
  "Low Grown": 330,
};

/** Roughly how wide a page's content column is (297mm page minus its own left/right padding,
 *  at the density sizes in play) — only used to categorize a section as one row vs. several,
 *  so an approximation is fine; being off by a few px never changes that categorical answer in
 *  practice. Kept here rather than measured live because the answer only needs to be "1 row or
 *  more than 1", decided once per render, not tracked pixel-for-pixel. */
const PAGE_CONTENT_WIDTH_PX = 1090;

/** Whether a section's own table cards wrap onto more than one row at its resolved column
 *  count — used to decide how that section absorbs its page's leftover height (see `.section`'s
 *  own CSS comment). A single-row section (every High Grown/Medium Grown/Unorthodox table:
 *  exactly 2 tables at a 2-column width) stretched via flex-grow just centers that one row with
 *  a big empty band above and below it — content reads as floating inside an oversized card,
 *  not "filling the page." A genuinely multi-row section (Low Grown's 13 tables, or H&M
 *  Orthodox/Off Grades/Dust's 4-6) has real rows to spread extra height BETWEEN via
 *  align-content, which reads as a deliberately spacious table instead. */
function isMultiRowSection(sectionTitle: string, tableCount: number): boolean {
  const minWidth = SECTION_MIN_WIDTH[sectionTitle] ?? 480;
  const cols = Math.max(1, Math.floor((PAGE_CONTENT_WIDTH_PX + 4) / (minWidth + 4)));
  return Math.ceil(tableCount / cols) > 1;
}

/** A row's label always tells you which merged tier(s) it is (see MarketBulletinEngine.cs's
 *  BuildRow calls): every "Best"/"Brighter" row merges Select Best + Best, every "Other"/
 *  "Poor"/"Others" row merges Below Best + Poor, and "Select Best" alone is the top 25%. Used
 *  to give the two extremes a subtle accent so the eye can scan quality without reading every
 *  label — deliberately leaves the middle tiers and non-quality rows (Nuwara Eliya, and the
 *  High/Medium/Low elevation bands inside Off Grades/Dust's Better/Other tables) unaccented so
 *  the color stays meaningful rather than decorating every row. */
function tierAccent(label: string): "top" | "poor" | "neutral" {
  if (label === "Select Best" || label.startsWith("Best") || label.startsWith("Brighter")) return "top";
  if (label === "Poor" || label === "Others" || label.startsWith("Other")) return "poor";
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

/** Purely numeric — no narrative text, just a directional arrow comparing this week's midpoint
 *  price to last week's, so the reader gets an at-a-glance "dearer/easier" cue the same way the
 *  original bulletin's prose did, without generating any prose of our own. */
function Delta({ row }: { row: BulletinRow }) {
  const { thisWeek: tw, lastWeek: lw } = row;
  if (tw.min === null || tw.max === null || lw.min === null || lw.max === null) return <span className={styles.delta} aria-hidden="true" />;
  const twMid = (tw.min + tw.max) / 2;
  const lwMid = (lw.min + lw.max) / 2;
  if (twMid === lwMid) return <span className={styles.delta} aria-hidden="true" />;
  const up = twMid > lwMid;
  return (
    <span className={`${styles.delta} ${up ? styles.deltaUp : styles.deltaDown}`} title={up ? "Dearer than last week" : "Easier than last week"}>
      {up ? "▲" : "▼"}
    </span>
  );
}

function RangeRow({ row, zebra }: { row: BulletinRow; zebra: boolean }) {
  return (
    <div className={styles.row} data-zebra={zebra ? "true" : "false"} data-tier={tierAccent(row.label)}>
      <span className={styles.rowLabel} title={row.label}>
        {row.label}
      </span>
      <span className={`${styles.rowVal} ${styles.rowValThis}`}>{formatRange(row.thisWeek)}</span>
      <Delta row={row} />
      <span className={`${styles.rowVal} ${styles.rowValLast}`}>{formatRange(row.lastWeek)}</span>
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
        <span>This Week</span>
        <span className={styles.colHeadSpacer}>&nbsp;</span>
        <span>Last Week</span>
      </div>
      {table.rows.map((r, i) => (
        <RangeRow key={i} row={r} zebra={i % 2 === 1} />
      ))}
    </div>
  );
}

function SectionCard({ section }: { section: BulletinSection }) {
  const minWidth = SECTION_MIN_WIDTH[section.title] ?? 480;
  const flow = isMultiRowSection(section.title, section.tables.length) ? "grow" : "compact";
  return (
    <div className={styles.section} data-mb-flow={flow}>
      <div className={styles.sectionHead}>{section.title}</div>
      {section.tables.length === 0 ? (
        <div className={styles.sectionEmpty}>No matching lots for this section.</div>
      ) : (
        <div className={styles.tableGrid} style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${minWidth}px, 1fr))` }}>
          {section.tables.map((t, i) => (
            <TableCard key={i} table={t} />
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
 *  total, so it's the one that drives the wedges — average price is shown as a plain number next
 *  to each wedge instead of a second pie (see PieSlot's own doc comment for why: real sale data
 *  showed a price-share pie barely changes shape week to week even when real Rs/kg prices swing
 *  several percent, because all four tiers move together). */
function tierQuantities(tiers: MonthlySaleSlot["tiers"]): number[] {
  if (!tiers) return [0, 0, 0, 0];
  return TIER_ORDER.map((name) => tiers.find((t) => t.tier === name)?.quantityKg ?? 0);
}

function tierPrice(tiers: MonthlySaleSlot["tiers"], tier: (typeof TIER_ORDER)[number]): number | null {
  return tiers?.find((t) => t.tier === tier)?.averagePrice ?? null;
}

function formatKg(n: number): string {
  return `${Math.round(n).toLocaleString()} Kg`;
}

function formatPrice(n: number): string {
  return `Rs ${Math.round(n).toLocaleString()}`;
}

const PIE_CX = 50;
const PIE_CY = 50;
const PIE_R = 44;

function polarPoint(angleDeg: number): { x: number; y: number } {
  const rad = ((angleDeg - 90) * Math.PI) / 180; // -90 so 0deg sits at 12 o'clock
  return { x: PIE_CX + PIE_R * Math.cos(rad), y: PIE_CY + PIE_R * Math.sin(rad) };
}

/** One sale's four tiers as an actual pie chart — a wedge per tier, sized by its share of the
 *  total, going clockwise from 12 o'clock in TIER_ORDER (Select Best first) — a literal pie
 *  chart per the user's own sketch, replacing this file's earlier ring and split-circle attempts.
 *  A single non-zero tier is drawn as a plain filled circle rather than a wedge: the general arc
 *  path degenerates to a zero-length arc when its own share is the full 360°, since the start and
 *  end points coincide. Returns null for an all-zero sale so the caller can draw an empty
 *  placeholder circle instead of a broken chart. */
function pieSlices(values: number[]): { tier: (typeof TIER_ORDER)[number]; d?: string; fullCircle?: boolean }[] | null {
  const total = values.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  const nonZero = values.filter((v) => v > 0);
  if (nonZero.length === 1) {
    const i = values.findIndex((v) => v > 0);
    return [{ tier: TIER_ORDER[i], fullCircle: true }];
  }
  let angle = 0;
  const slices: { tier: (typeof TIER_ORDER)[number]; d: string }[] = [];
  values.forEach((v, i) => {
    if (v <= 0) return;
    const sweep = (v / total) * 360;
    const start = polarPoint(angle);
    const end = polarPoint(angle + sweep);
    const largeArc = sweep > 180 ? 1 : 0;
    slices.push({ tier: TIER_ORDER[i], d: `M ${PIE_CX} ${PIE_CY} L ${start.x} ${start.y} A ${PIE_R} ${PIE_R} 0 ${largeArc} 1 ${end.x} ${end.y} Z` });
    angle += sweep;
  });
  return slices;
}

/** One sale's combined chart: a pie whose wedges are each tier's share of the sale's total kg,
 *  plus a small legend beside it listing each tier's actual average price — one card per ordinal
 *  sale slot, within whichever row (Last Month / This Month) it belongs to. Two separate pies
 *  (quantity share AND price share) were tried first; dropped once real sale data showed the
 *  price-share pie stays visually identical week to week regardless of real price movement (see
 *  tierQuantities' own doc comment) — a single pie plus the real Rs/kg numbers actually shows
 *  both what changed in mix and what changed in price. `slot` is undefined either when that
 *  ordinal position doesn't exist for this side (e.g. last month only had 4 sales, this month has
 *  a 5th) or when this month hasn't reached that sale yet as of the sale currently being viewed
 *  (MarketBulletinMonthlyEngine's own "as of this sale" cutoff) — both render as a hollow circle
 *  with dashed price rows, per the user's own sketch showing not-yet-happened weeks as empty
 *  outlines, rather than a gap that could read as a layout bug. */
function PieSlot({ slot }: { slot?: MonthlySaleSlot }) {
  const slices = pieSlices(tierQuantities(slot?.tiers ?? null));
  const totalKg = slot?.tiers?.reduce((sum, t) => sum + (t.quantityKg ?? 0), 0) ?? 0;
  return (
    <div className={styles.donutCard}>
      <div className={styles.pieCardBody}>
        <svg viewBox={`0 0 ${PIE_CX * 2} ${PIE_CY * 2}`} className={styles.donutSvg} aria-hidden="true">
          {slices ? (
            slices.map((s) =>
              s.fullCircle ? (
                <circle key={s.tier} cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill={TIER_COLORS[s.tier]} stroke="#fff" strokeWidth={1} />
              ) : (
                <path key={s.tier} d={s.d} fill={TIER_COLORS[s.tier]} stroke="#fff" strokeWidth={1} />
              ),
            )
          ) : (
            <circle cx={PIE_CX} cy={PIE_CY} r={PIE_R} fill="none" stroke="#c9c4b0" strokeWidth={2} />
          )}
        </svg>
        <div className={styles.pieLegendList}>
          {TIER_ORDER.map((tier) => {
            const price = tierPrice(slot?.tiers ?? null, tier);
            return (
              <div key={tier} className={styles.pieLegendRow}>
                <span className={styles.pieLegendSwatch} style={{ background: TIER_COLORS[tier] }} aria-hidden="true" />
                <span className={styles.pieLegendTier}>{TIER_SHORT[tier]}</span>
                <span className={styles.pieLegendPrice}>{price !== null ? formatPrice(price) : "—"}</span>
              </div>
            );
          })}
        </div>
      </div>
      <div className={slices ? styles.donutLabelThis : styles.donutLabelPending} title={slot?.sourceName ?? undefined}>
        {slot?.sourceName ?? "Not yet"}
      </div>
      {slices && <div className={styles.pieTotalKg}>{formatKg(totalKg)} total</div>}
    </div>
  );
}

/** One month's row of pie slots — "Last Month"/"This Month" are two separate, clearly labeled
 *  groups (per the user's own sketch) rather than fused into one chart per ordinal position, so
 *  the two months read as two plain rows stacked vertically. `slotCount` is passed in (rather than
 *  derived from `slots.length`) so both rows always render the same number of columns even when
 *  one side has an extra slot (a 5-sale month compared against a 4-sale one) — the shorter row's
 *  missing columns fall through to PieSlot's own undefined-slot placeholder. */
function MonthlySaleRow({ heading, monthLabel, slots, slotCount }: { heading: string; monthLabel: string; slots: MonthlySaleSlot[]; slotCount: number }) {
  return (
    <div className={styles.pieRowGroup}>
      <div className={styles.pieRowLabel}>
        {heading} <span className={styles.pieRowLabelSub}>{monthLabel}</span>
      </div>
      <div className={styles.donutRow}>
        {Array.from({ length: slotCount }, (_, i) => (
          <PieSlot key={i} slot={slots[i]} />
        ))}
      </div>
    </div>
  );
}

/** The whole month-over-month comparison — one section, 8 (or 10, in a 5-sale month) pie cards
 *  total rather than a separate quantity section and a separate price section duplicating every
 *  card. Reuses the exact .section/.sectionHead styling pages 1-3 use for their grade tables, so
 *  page 4 fits the same visual language and the same page-filling flex-grow/space-evenly
 *  mechanism (see .section's own CSS comment) without needing a parallel layout system. */
function MonthlyComparisonSection({ comparison }: { comparison: MonthlyComparison }) {
  const slotCount = Math.max(comparison.thisMonth.length, comparison.lastMonth.length);
  return (
    <div className={styles.section} data-mb-flow="compact">
      <div className={styles.sectionHead}>
        Monthly Sale Comparison — Asia Siyaka <span className={styles.monthlyUnit}>wedge = Kg share · label = Rs/Kg</span>
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
        <MonthlySaleRow heading="Last Month" monthLabel={comparison.lastMonthLabel} slots={comparison.lastMonth} slotCount={slotCount} />
        <MonthlySaleRow heading="This Month" monthLabel={comparison.thisMonthLabel} slots={comparison.thisMonth} slotCount={slotCount} />
      </div>
    </div>
  );
}

/** Masthead/footer are identical across every page (grade tables AND the monthly-pie page
 *  alike) except the page number itself — pulled out once both pages 1-3's own PAGE_GROUPS.map
 *  and page 4 need to render them, rather than a fourth copy-pasted inline block. */
function Masthead({ bulletin, saleNo, prevSaleNo }: { bulletin: MarketBulletin; saleNo: string; prevSaleNo: string | null }) {
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
        <span className={styles.mastheadSub}>Weekly Market Grade Classification/Quotation</span>
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

export default function MarketBulletinBulletin({ bulletin, monthly, onReady }: MarketBulletinBulletinProps) {
  const byTitle = new Map(bulletin.sections.map((s) => [s.title, s]));
  const saleNo = extractSaleNumber(bulletin.sourceName);
  const prevSaleNo = bulletin.previousSourceName ? extractSaleNumber(bulletin.previousSourceName) : null;
  const totalPages = PAGE_GROUPS.length + (monthly ? 1 : 0);

  const rootRef = useRef<HTMLDivElement>(null);
  const [rung, setRung] = useState(0);
  const [settled, setSettled] = useState(false);

  // Reset whenever a new sale's data comes in, OR when monthly goes from not-yet-loaded to
  // loaded — monthly fetches independently of the sale-specific bulletin and typically resolves
  // AFTER the first render, so a fit that already settled before page 4 existed would never
  // re-check itself against its added height without this.
  useLayoutEffect(() => {
    setRung(0);
    setSettled(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bulletin, monthly]);

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
          1-3's per-grade tables: a market-wide (not per-grade-family) snapshot, two rows of pie
          charts — Last Month's sales above, This Month's below, one combined pie per ordinal sale
          position (wedges = quantity share, label list = real average price per tier). Rendered
          only once monthly data has actually loaded — see MarketBulletinBulletinProps' own doc
          comment on why this degrades to "just 3 pages" rather than a broken 4th page when it
          hasn't (or the sale's own name doesn't parse into a month at all). */}
      {monthly && (
        <div className={styles.page} data-mb-page="true">
          <Masthead bulletin={bulletin} saleNo={saleNo} prevSaleNo={prevSaleNo} />
          <div className={styles.sections}>
            <MonthlyComparisonSection comparison={monthly} />
          </div>
          <Footer saleNo={saleNo} pageNumber={totalPages} totalPages={totalPages} />
        </div>
      )}
    </div>
  );
}
