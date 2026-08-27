"use client";

/* =====================================================================
   TOP PRICE PAGE — the executive bulletin combining every ranked region
   (Low Grown through CTC Teas) from all four Combined Report families
   into one document. Region grouping is a port of the original
   standalone app's asc-analytics.js (topPricePage/regionForItem); the
   page layout is this app's own design — a uniform grid of equal-width
   region cards, LPT bin-packed via planRegionPageLayout (the same
   packer the Excel writer below uses) with a density auto-fit layered
   on top so real sale data always lands within TPP_MAX_PAGES pages. See
   the "BULLETIN UNIFORM GRID LAYOUT" section below for why this departs
   from an earlier masonry design that mixed full-width and narrow
   region cards.

   The on-screen bulletin itself is TopPriceBulletin.tsx (a real DOM
   component, not built here) — this file supplies the layout (
   planTppBulletinAutoFit) it renders from, and exportTopPricePagePdf
   screenshots that rendered DOM into the PDF (html2canvas), rather than
   redrawing it a second time as vector PDF.

   Scope note: the original's "Top Price Page" is normally built inside
   an interactive WYSIWYG editor (asc-studio.js's mountStudio) that lets
   staff highlight "record price" rows, fill in manual cards for a
   region the workbook had no data for, and hand-type the Reference Data
   sheet's tables (Order of Sale, Selling Brokers, Currencies, Sale/
   Weekly Averages, Crop & Weather). That editor doesn't exist here yet
   (a separate, much larger piece) — this is the auto-generated bulletin
   only: the 11 ranked region cards come from real Combined Report data,
   the Reference Data sheet reproduces the original's exact table
   structure with its own blank placeholder rows (headers + labels,
   no invented numbers), and "record price" highlighting is left off
   since nothing marks a row as a record without that editor.
   ===================================================================== */

import type { AuctionReport, CombinedReport, RankedLotRow } from "@/types/api";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";

// ---- REGION GROUPING — port of asc-analytics.js's regionForItem/topPricePage ---------------

interface FlatItem {
  sheetTitle: string;
  blockTitle: string;
  grade: string;
  row: RankedLotRow;
}

function flattenCombined(combined: CombinedReport): FlatItem[] {
  const out: FlatItem[] = [];
  for (const report of combined.reports) {
    for (const sheet of report.sheets) {
      for (const block of sheet.blocks) {
        for (const g of block.grades) {
          for (const row of g.rows) out.push({ sheetTitle: sheet.title, blockTitle: block.title, grade: g.grade, row });
        }
      }
    }
  }
  return out;
}

const SHEET_BLOCK_TO_REGION: Record<string, string> = {
  "UH & UM|UH": "Uva High",
  "UH & UM|UM": "Uva Medium",
  "WH & WM|WH": "Western High",
  "WH & WM|WM": "Western Medium",
  "Nuwara Eliya & Udupussellawa|Nuwara Eliya": "Nuwara Eliya",
  "Nuwara Eliya & Udupussellawa|Udupussellawa": "Udapussellawa",
  "Low Grown|Low Grown": "Low Grown",
  "Premium Flowery|Premium Flowery": "Premium Flowery",
};

function regionFor(item: FlatItem): string {
  const direct = SHEET_BLOCK_TO_REGION[`${item.sheetTitle}|${item.blockTitle}`];
  if (direct) return direct;
  if (item.sheetTitle === "CTC") return "CTC Teas";
  if (item.sheetTitle === "Off Grades & Dust") return `Others — ${item.blockTitle}`;
  return `${item.sheetTitle} — ${item.blockTitle}`;
}

const REGION_ORDER = [
  "Uva High",
  "Uva Medium",
  "Western High",
  "Western Medium",
  "Nuwara Eliya",
  "Udapussellawa",
];

// CTC's own elevation blocks read as one section, split back out in this fixed reading order.
// The original keys this "WH"/"WM"/"LOW"; this app's Elevation column instead uses the single-
// letter code "L" for low-grown (verified against real sale data), so the third entry is adapted
// accordingly — everything else about the ordering rule is unchanged.
const CTC_BLOCK_ORDER = ["WH", "WM", "L"];

export interface TppGradeGroup {
  grade: string;
  block: string;
  rows: RankedLotRow[];
}

export interface TppAutoCategory {
  title: string;
  grades: TppGradeGroup[];
}

/** Groups every ranked row across all four report families into the 11 Top Price Page regions —
 *  port of asc-analytics.js's topPricePage(). Keyed by block+grade (not grade alone) so CTC's
 *  three elevation blocks never merge a grade like BOP1 that exists independently in each. */
export function buildAutoCategories(combined: CombinedReport): TppAutoCategory[] {
  const items = flattenCombined(combined);
  const byRegion = new Map<string, Map<string, TppGradeGroup>>();

  for (const item of items) {
    if (!(item.row.price > 0)) continue;
    const region = regionFor(item);
    const gradeKey = `${item.blockTitle}${item.grade}`;
    if (!byRegion.has(region)) byRegion.set(region, new Map());
    const byGrade = byRegion.get(region)!;
    if (!byGrade.has(gradeKey)) byGrade.set(gradeKey, { grade: item.grade, block: item.blockTitle, rows: [] });
    byGrade.get(gradeKey)!.rows.push(item.row);
  }

  const regions = [...byRegion.keys()].sort((a, b) => {
    const ai = REGION_ORDER.indexOf(a);
    const bi = REGION_ORDER.indexOf(b);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.localeCompare(b); // CTC / Others sub-regions, alphabetically
  });

  return regions.map((region) => {
    const groups = [...byRegion.get(region)!.values()].sort((a, b) => {
      const ai = CTC_BLOCK_ORDER.indexOf((a.block || "").toUpperCase());
      const bi = CTC_BLOCK_ORDER.indexOf((b.block || "").toUpperCase());
      if (ai !== bi) {
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      }
      return 0; // stable: grades already arrive in report-common's own canonical order
    });
    return {
      title: region,
      grades: groups.map((g) => ({ grade: g.grade, block: g.block, rows: [...g.rows].sort((a, b) => b.price - a.price) })),
    };
  });
}

// ---- MASONRY PAGE LAYOUT — port of asc-studio.js's estimateTppAutoCardHeight/
// packTppRegionColumns/bestTppRegionColumnCount/planTppRegionPageLayout ----------------------

export interface TppRegionEntry {
  title: string;
  height: number;
  category: TppAutoCategory;
  /** Longest actual grade code (characters) within THIS region alone — deliberately per-region,
   *  not sale-wide: `.grade`'s column width only needs to widen for a region that actually has a
   *  long code, and widening it sale-wide would shrink every OTHER region's Selling Mark budget
   *  for no reason (see gradeBasisFor's own doc comment and planTppFullWidthLayout's per-section
   *  use of it). */
  maxGradeChars: number;
  /** Longest actual Selling Mark name (characters) within THIS region alone — same per-region
   *  reasoning as maxGradeChars, and the actual fix for real long mark names truncating to an
   *  unreadable "ARUNA PASSA…"/"GOLDEN GARD…" a few characters in: spanColsForRegion sizes THIS
   *  region's own internal column count (capped at TPP_MARK_LEGIBILITY_CAP) so its own longest
   *  name renders in full wherever the page budget allows it, rather than truncating every region
   *  down to one sale-wide guessed floor regardless of what its own names actually need. */
  maxMarkChars: number;
}

const TPP_REGION_COLUMNS = 4;
const TPP_REGION_PAGE_BUDGET = 790;

function estimateAutoCardHeight(cat: TppAutoCategory): number {
  const HEAD = 26,
    EMPTY = 38,
    ROW = 18,
    BLOCK = 24,
    GRADE_GAP = 6;
  const rowCount = cat.grades.reduce((n, g) => n + g.rows.length, 0);
  if (!rowCount) return HEAD + EMPTY;
  const blockCount = new Set(cat.grades.map((g) => g.block || "")).size;
  const blockRows = blockCount > 1 ? blockCount : 0;
  const gradeGaps = Math.max(0, cat.grades.length - Math.max(blockCount, 1));
  return HEAD + rowCount * ROW + blockRows * BLOCK + gradeGaps * GRADE_GAP;
}

interface PackResult {
  placements: { entry: TppRegionEntry; col: number }[];
  heights: number[];
  usedCols: number;
  overflowed: boolean;
}

/** LPT ("Longest Processing Time") bin-packing: cards assigned largest-first to whichever
 *  column is currently shortest — a standard, well-bounded heuristic (worst case within 4/3 of
 *  optimal) that avoids a big card landing on top of a column already loaded with other big
 *  cards. Region reading order is unaffected — only which column each card renders in.
 *  `getHeight`/`gap` default to Excel's own static per-entry height and a flat 10px gap; the
 *  bulletin's density auto-fit (planTppBulletinAutoFit below) passes its own preset-scoped height
 *  function, budget and gap instead, so this one packer/planRegionPageLayout serves both callers. */
function packRegionColumns(
  pageEntries: TppRegionEntry[],
  cols: number,
  budget: number,
  getHeight: (e: TppRegionEntry) => number = (e) => e.height,
  gap = 10
): PackResult {
  const heights = new Array(cols).fill(0);
  const colOf = new Map<TppRegionEntry, number>();
  [...pageEntries]
    .sort((a, b) => getHeight(b) - getHeight(a))
    .forEach((entry) => {
      let col = 0;
      for (let c = 1; c < cols; c++) if (heights[c] < heights[col]) col = c;
      const gapBefore = heights[col] > 0 ? gap : 0;
      heights[col] += gapBefore + getHeight(entry);
      colOf.set(entry, col);
    });
  const placements = pageEntries.map((entry) => ({ entry, col: colOf.get(entry)! }));
  return { placements, heights, usedCols: Math.max(...placements.map((p) => p.col)) + 1, overflowed: heights.some((h) => h > budget) };
}

/** `preferFewestColumns` (default, Excel's own usage): among column counts that don't overflow,
 *  prefer the LARGEST resulting fill — i.e. the closest-to-full/fewest-columns arrangement, which
 *  is what makes a printed Excel sheet's own column count feel deliberate rather than needlessly
 *  spread thin. The bulletin's own small-band closing (planTppRegionBandedLayout) needs the
 *  OPPOSITE preference: it wants a batch of small regions to occupy as LITTLE height as possible
 *  (spread across as many columns as the budget allows) so it doesn't eat into the room a
 *  following band on the SAME page needs — using the Excel-style "largest fill" preference there
 *  was a real bug: it picked the tallest valid packing for an ordinary batch of small regions,
 *  which then left a big region needing its own wide band with less remaining room than the page
 *  budget actually had, triggering pages the data didn't truly need. */
function bestRegionColumnCount(
  pageCards: TppRegionEntry[],
  budget: number,
  maxCols: number,
  allowFallback = true,
  getHeight?: (e: TppRegionEntry) => number,
  gap?: number,
  preferFewestColumns = true
): { packed: PackResult; cols: number; fill: number } | null {
  let best: { packed: PackResult; fill: number; cols: number } | null = null;
  for (let cols = 1; cols <= Math.min(maxCols, pageCards.length); cols++) {
    const packed = packRegionColumns(pageCards, cols, budget, getHeight, gap);
    if (packed.overflowed) continue;
    const fill = Math.max(...packed.heights);
    const better = preferFewestColumns
      ? !best || fill > best.fill || (fill === best.fill && cols > best.cols)
      : !best || fill < best.fill || (fill === best.fill && cols > best.cols);
    if (better) best = { packed, fill, cols };
  }
  if (!best && allowFallback) {
    const cols = Math.min(maxCols, pageCards.length);
    const packed = packRegionColumns(pageCards, cols, budget, getHeight, gap);
    best = { packed, fill: Math.max(...packed.heights), cols };
  }
  return best;
}

// ---- BULLETIN FULL-WIDTH FLOW LAYOUT — every region is its own full-page-width section,
// stacked top to bottom in reading order (never split into page-wide side-by-side card columns),
// with a density auto-fit layered on top so real sale data (which regularly runs 250-320+ ranked
// rows across the 11 fixed regions) always lands within TPP_MAX_PAGES. TWO earlier designs were
// tried and rejected here: a masonry of full-width "wide" bands mixed with narrow 3-up "grid"
// bands (wildly inconsistent card sizes on real data), then a uniform side-by-side grid of
// same-width cards (which fixed the inconsistency but still left visible gaps whenever a batch of
// regions didn't happen to divide evenly across however many page-wide columns were in play, and
// alignment problems when different bands on the same page needed different column counts). A
// full-width section per region sidesteps both: each region reflows its OWN rows into however
// many of ITS OWN internal columns suit ITS OWN row count (spanColsForRegion below) — a sparse
// region renders as one compact block instead of a few items spread thin, a dense one spreads
// across several columns instead of overflowing a shared column height, and there is no shared
// page-wide column count for two sections to disagree about in the first place.

/** Every CSS number the bulletin's markup needs, sized for one specific sale's actual data
 *  volume rather than picked from a handful of fixed buckets — see planTppBulletinAutoFit below
 *  for how `t` (1 = most spacious, 0 = densest) is solved per sale. TopPriceBulletin.tsx sets
 *  every field here as an inline CSS custom property on `.bulletin`, and
 *  TopPriceBulletin.module.css's base rules consume `var(--tpp-*)` directly — there are no
 *  discrete `[data-density="x"]` breakpoints to keep in sync with this file, unlike an earlier
 *  fixed-preset design: change a number here and the rendered page (and the PDF screenshot of
 *  it) follows immediately. */
export interface TppDensity {
  /** Cosmetic label only (shown in the page's own status line) — never branched on. */
  name: string;
  /** 1 = most spacious end of the range, 0 = densest — the actual solved value for this sale. */
  t: number;
  /** head/empty/row/block/gradeGap/pageBudget/gap are all DERIVED from `css` below (see
   *  realRowHeight/realHeadHeight/etc. and tppPageBudget) — not independently tuned numbers.
   *  They used to be, and that's exactly what let the JS page-count estimate quietly disagree
   *  with what actually renders (a page whose real height came out ~40% over true A4 landscape
   *  before this was measured and fixed) — deriving them from the same numbers that drive the
   *  CSS custom properties is what keeps the two permanently in sync. */
  head: number;
  empty: number;
  row: number;
  block: number;
  gradeGap: number;
  /** How much card height ONE true-A4-landscape page can actually hold — see tppPageBudget. */
  pageBudget: number;
  gap: number;
  css: {
    headPadV: number;
    headPadH: number;
    headFontSize: number;
    blockPadV: number;
    blockPadH: number;
    blockMarginTop: number;
    blockFontSize: number;
    rowGap: number;
    rowPadV: number;
    rowPadH: number;
    rowFontSize: number;
    rowLineHeight: number;
    gradeStartMarginTop: number;
    gradeBasis: number;
    gradeFontSize: number;
    atBasis: number;
    priceBasis: number;
    priceFontSize: number;
    oursPadLeft: number;
    mastheadPadV: number;
    mastheadPadH: number;
    mastheadMetaFontSize: number;
    mastheadTitleFontSize: number;
    mastheadSubFontSize: number;
    mastheadRightFontSize: number;
    mastheadPageFontSize: number;
    footerMarginTop: number;
    footerPadTop: number;
    footerCaptionFontSize: number;
    gridGap: number;
  };
}

/** The two ends of the continuum planTppBulletinAutoFit interpolates between — MAX is the most
 *  spacious/legible a bulletin ever needs to be (a small sale gets exactly this), MIN is the
 *  densest this design considers still legible in print (verified by screenshot at full pixel
 *  resolution, same as every other density number in this file). Only `css` (the actual CSS
 *  custom properties) is tuned here — every JS-estimate field (head/row/block/gradeGap/
 *  pageBudget/gap) is derived from `css` at build time (tppDensityAt below), so there's no way
 *  for a font size to shrink without its column/row-height estimate moving with it. gridCols is
 *  a separate escalation dimension entirely — see planTppBulletinAutoFit. */
const TPP_DENSITY_MAX: { css: TppDensity["css"] } = {
  css: {
    headPadV: 6,
    headPadH: 10,
    headFontSize: 10.5,
    blockPadV: 4,
    blockPadH: 10,
    blockMarginTop: 8,
    blockFontSize: 9,
    rowGap: 6,
    rowPadV: 2,
    rowPadH: 10,
    rowFontSize: 10.5,
    rowLineHeight: 1.3,
    gradeStartMarginTop: 6,
    gradeBasis: 44,
    gradeFontSize: 9.5,
    atBasis: 10,
    priceBasis: 54,
    priceFontSize: 11,
    oursPadLeft: 7,
    mastheadPadV: 11,
    mastheadPadH: 22,
    mastheadMetaFontSize: 12.5,
    mastheadTitleFontSize: 22,
    mastheadSubFontSize: 11,
    mastheadRightFontSize: 12.5,
    mastheadPageFontSize: 9.5,
    footerMarginTop: 4,
    footerPadTop: 10,
    footerCaptionFontSize: 10,
    gridGap: 12,
  },
};

const TPP_DENSITY_MIN: { css: TppDensity["css"] } = {
  css: {
    headPadV: 3,
    headPadH: 6,
    headFontSize: 7,
    blockPadV: 1,
    blockPadH: 5,
    blockMarginTop: 3,
    blockFontSize: 6,
    rowGap: 3,
    rowPadV: 1,
    rowPadH: 5,
    rowFontSize: 6.5,
    rowLineHeight: 1.2,
    gradeStartMarginTop: 2,
    gradeBasis: 28,
    gradeFontSize: 6.5,
    atBasis: 6,
    priceBasis: 38,
    priceFontSize: 7,
    oursPadLeft: 4,
    mastheadPadV: 6,
    mastheadPadH: 14,
    mastheadMetaFontSize: 9.5,
    mastheadTitleFontSize: 15,
    mastheadSubFontSize: 8.5,
    mastheadRightFontSize: 9.5,
    mastheadPageFontSize: 7.5,
    footerMarginTop: 1,
    footerPadTop: 5,
    footerCaptionFontSize: 8,
    gridGap: 6,
  },
};

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** The bulletin's own printable width in CSS px at the capture resolution the on-screen DOM
 *  actually renders at (297mm minus .page's 16px padding on each side) — measured directly off
 *  the live DOM (getBoundingClientRect) during tuning, not assumed from the mm conversion alone,
 *  since that's what tppMarkMaxChars's column-width arithmetic below needs to match reality. */
const TPP_PAGE_CONTENT_WIDTH = 1085;

/** True A4 landscape height in CSS px at 96dpi (210mm), and the fixed page furniture around the
 *  body row (.page's own 16px padding top+bottom, and its 14px gap between the masthead/body/
 *  footer rows, twice — see TopPriceBulletin.module.css's .page rule). Used only to derive
 *  pageBudget below — the real number the estimate has to match is "how much height is actually
 *  left for cards on a true A4 sheet", not an arbitrary target that happened to produce roughly
 *  the right page count on past test data (that was the actual bug: .page had no fixed height at
 *  all, so a pageBudget that was quietly wrong by 40%+ was never caught — .page is now
 *  `min-height: 210mm` and this constant is what keeps the JS estimate honest against it). */
const TPP_PAGE_HEIGHT_PX = (210 * 96) / 25.4;
const TPP_PAGE_PAD_PX = 16;
const TPP_PAGE_ROW_GAP_PX = 14;

/** Fixed height (in px) of an empty region card's "No ranked lots…" placeholder line —
 *  TopPriceBulletin.module.css's `.empty` rule is intentionally NOT density-scaled (an empty
 *  card's exact size doesn't affect legibility of anything), so this doesn't need to move with
 *  `t` either. Derived the same way as every other real height below: fontSize * line-height
 *  (1.5, this font's own default — see the other realXHeight functions) + vertical padding. */
const TPP_EMPTY_HEIGHT = 10.5 * 1.5 + 12 * 2;

/** Every one of these converts a resolved `css` sub-object into the REAL rendered height (in px)
 *  of that element, calibrated against live DOM measurements taken at several different `t`
 *  values (not guessed): `1.5` is this app's actual loaded font's default line-height factor for
 *  an element with no explicit `line-height` set (confirmed to match head/masthead/footer exactly
 *  across every sample measured); `.row` sets an explicit line-height itself, so its formula uses
 *  that number directly instead. These are the ONLY place row/head/block/masthead/footer height
 *  is computed — estimateTppAutoCardHeight and tppPageBudget both call these rather than keeping
 *  a second, independently-tuned set of numbers that can silently drift out of sync with what
 *  actually renders (exactly what happened before this was measured: page height was off by 40%
 *  because "head"/"row"/etc were hand-guessed numbers that were never checked against a real
 *  fixed-height page at all). */
function realRowHeight(css: TppDensity["css"]): number {
  return css.rowFontSize * css.rowLineHeight + css.rowPadV * 2 + 1;
}
function realHeadHeight(css: TppDensity["css"]): number {
  return css.headFontSize * 1.5 + css.headPadV * 2;
}
function realBlockHeight(css: TppDensity["css"]): number {
  return css.blockFontSize * 1.5 + css.blockPadV + 1;
}
function realMastheadHeight(css: TppDensity["css"]): number {
  return css.mastheadPadV * 2 + (css.mastheadTitleFontSize + css.mastheadSubFontSize) * 1.5 + 2;
}
function realFooterHeight(css: TppDensity["css"]): number {
  return css.footerCaptionFontSize * 1.5 + css.footerPadTop + 1;
}

/** How much card height ONE true-A4-landscape page can actually hold at this density — the real
 *  210mm sheet height minus its own fixed furniture (padding, inter-row gaps, masthead, footer),
 *  all derived from the SAME `css` numbers that actually render, per this section's own header
 *  comment. */
function tppPageBudget(css: TppDensity["css"]): number {
  return TPP_PAGE_HEIGHT_PX - TPP_PAGE_PAD_PX * 2 - TPP_PAGE_ROW_GAP_PX * 2 - realMastheadHeight(css) - realFooterHeight(css);
}

/** Average rendered character width as a fraction of font-size for this bulletin's sans-serif,
 *  mostly-uppercase Selling Mark text — picked conservatively (i.e. on the wide side) from real
 *  measured rects during tuning so a truncation decision never runs the actual text past its
 *  column, even for W/M-heavy names. Deliberately NOT the same font-size-dependent linear
 *  interpolation the JS-estimate fields use: the true safe character count is a function of the
 *  ACTUAL resolved column width and fixed-column overhead at this `t`, not an independent number
 *  guessed between two endpoints — an earlier version did the latter and produced real text
 *  collisions at in-between `t` values once gridCols rounded to a different integer than either
 *  endpoint's own hand-tuned character count assumed. */
const TPP_MARK_CHAR_WIDTH_RATIO = 0.62;

/** IBM Plex Mono's fixed per-character advance as a fraction of font-size (monospace, so this is
 *  exact rather than an average) — used to size `.grade`'s column to the LONGEST real grade code
 *  in this sale (gradeBasisFor below), the same way TPP_MARK_CHAR_WIDTH_RATIO sizes `.mark`'s
 *  truncation point. Unlike Selling Mark, grade codes are never truncated: they're short enough
 *  (a handful of characters) that fully committing the column to the longest one actually present
 *  costs little width, and a clipped grade code (unlike a clipped long company name) reads as
 *  wrong data rather than merely abbreviated. */
const TPP_GRADE_CHAR_WIDTH_RATIO = 0.6;

/** Small fixed allowance on top of the raw character-width product — covers `.grade`'s own
 *  0.02em letter-spacing (TopPriceBulletin.module.css) plus rounding, so the computed width is
 *  never one glyph short of what actually renders. */
const TPP_GRADE_WIDTH_PAD = 4;

/** `.grade`'s column width for one resolved font size, for ONE region — the density's own lerped
 *  default UNLESS THIS region's own longest actual grade code (TppRegionEntry.maxGradeChars) needs
 *  more room than that to render in full, in which case the column widens to fit it exactly.
 *  Deliberately per-region rather than a shared sale-wide number: an earlier version widened
 *  `css.gradeBasis` itself (one shared density field), which meant a single long grade code
 *  anywhere in the sale shrank the Selling Mark budget in EVERY region, including ones whose own
 *  grade codes were all short — exactly the kind of collateral truncation this function exists to
 *  avoid. Never shrinks below the density default (so ordinary short grade codes keep today's
 *  spacing) and never leaves a real grade code clipped by `.grade`'s `overflow: hidden`
 *  (TopPriceBulletin.module.css) — that CSS property is a safety net for the residual reflow
 *  padding, not a truncation mechanism the way `.mark`'s JS ellipsis is. */
function gradeBasisFor(defaultBasis: number, gradeFontSize: number, maxGradeChars: number): number {
  if (maxGradeChars <= 0) return defaultBasis;
  const required = Math.ceil(gradeFontSize * TPP_GRADE_CHAR_WIDTH_RATIO * maxGradeChars) + TPP_GRADE_WIDTH_PAD;
  return Math.max(defaultBasis, required);
}

/** `cols` is a section's own `spanCols` (see spanColsForRegion) — however many internal columns
 *  IT is reflowing its own rows across, dividing the SAME full page width every section shares.
 *  `gradeBasisPx` is THIS section's own resolved grade-column width (gradeBasisFor) — never
 *  `css.gradeBasis` directly, so a region with an unusually long grade code only spends its OWN
 *  Selling Mark budget on that width, not every other region's too. */
function tppMarkMaxCharsForCols(cols: number, css: TppDensity["css"], gradeBasisPx: number): number {
  const columnWidth = (TPP_PAGE_CONTENT_WIDTH - (cols - 1) * css.gridGap) / cols;
  const overhead = css.rowPadH * 2 + gradeBasisPx + css.atBasis + css.priceBasis + css.rowGap * 3;
  const available = columnWidth - overhead;
  return Math.max(4, Math.floor(available / (css.rowFontSize * TPP_MARK_CHAR_WIDTH_RATIO)));
}

/** Upper bound on how much column width a single region is ever allowed to demand for Selling
 *  Mark legibility — without this, one genuinely enormous outlier name (the raw MSL layout's own
 *  field is up to 30 characters, see [[msl-data-corpus]]) could force that one region down to a
 *  single absurdly-wide column regardless of how many rows it has. Real sale data measured while
 *  fixing this (Sale 33-2026, 259 ranked rows) tops out at 18-character names with a p90 of 16, so
 *  this comfortably covers the overwhelming majority of real names in full while still bounding
 *  the rare pathological case. */
const TPP_MARK_LEGIBILITY_CAP = 26;

/** THIS region's own real legibility target — its longest actual Selling Mark name
 *  (TppRegionEntry.maxMarkChars), capped at TPP_MARK_LEGIBILITY_CAP. Deliberately per-region, not
 *  a flat guessed constant: the earlier version of this mechanism used one fixed floor (12) for
 *  every region, which was too low to fit real 16-18 character names (exactly the "ARUNA PASSA…"/
 *  "GOLDEN GARD…" truncation this whole per-region sizing pass exists to fix) while ALSO being
 *  needlessly generous for a region whose own names are all short (wasting width that region's
 *  Selling Mark column never needed). */
function markLegibilityTarget(entry: TppRegionEntry): number {
  return Math.min(entry.maxMarkChars, TPP_MARK_LEGIBILITY_CAP);
}

/** The most internal columns a region can use while keeping every column's own markMaxChars at
 *  or above `requiredMarkChars` (markLegibilityTarget), for this section's own resolved
 *  `gradeBasisPx` — markMaxChars only shrinks as `cols` grows (each column gets a smaller share
 *  of the fixed page width), so this is a straightforward top-down scan rather than a search. */
function maxColsForMarkFloor(css: TppDensity["css"], gradeBasisPx: number, requiredMarkChars: number): number {
  for (let cols = TPP_MAX_SPAN_COLS; cols >= 1; cols--) {
    if (tppMarkMaxCharsForCols(cols, css, gradeBasisPx) >= requiredMarkChars) return cols;
  }
  return 1;
}

/** Builds the exact density for one continuous `t` (1 = TPP_DENSITY_MAX, 0 = TPP_DENSITY_MIN) —
 *  every `css` number moves together on the same fraction. `name` is a cosmetic three-way label
 *  purely for the page's own status line; nothing branches on it. `css.gradeBasis` here is always
 *  the plain lerped default — per-region widening (a region whose own longest grade code needs
 *  more room) happens downstream, per-section, in planTppFullWidthLayout via gradeBasisFor; see
 *  that function's own comment for why it's deliberately not folded in here. */
function tppDensityAt(t: number): TppDensity {
  const clamped = Math.max(0, Math.min(1, t));
  const css = Object.fromEntries(
    Object.keys(TPP_DENSITY_MAX.css).map((key) => {
      const k = key as keyof TppDensity["css"];
      return [k, lerp(TPP_DENSITY_MIN.css[k], TPP_DENSITY_MAX.css[k], clamped)];
    })
  ) as TppDensity["css"];
  return {
    name: clamped >= 0.66 ? "spacious" : clamped >= 0.33 ? "balanced" : "dense",
    t: clamped,
    head: realHeadHeight(css),
    empty: TPP_EMPTY_HEIGHT,
    row: realRowHeight(css),
    block: realBlockHeight(css),
    gradeGap: css.gradeStartMarginTop,
    pageBudget: tppPageBudget(css),
    gap: css.gridGap,
    css,
  };
}

/** The bulletin's own fixed page-count target — a TARGET, not a hard ceiling: a sale so large it
 *  still doesn't fit even at the densest end of the range gets however many pages it genuinely
 *  needs rather than losing rows. */
export const TPP_MAX_PAGES = 2;

/** How finely planTppBulletinAutoFit scans `t` — 41 steps (2.5% each) is far more than enough
 *  resolution for a human to perceive as "tailored to this sale" while staying cheap: each step
 *  is just a re-run of the same flow layout over ~11 entries. */
const TPP_FIT_STEPS = 40;

/** `spanCols` is how many of this SECTION's own internal reading columns its rows reflow into.
 *  Every region is a full-width section now (see this file's own header comment on why: stacking
 *  narrower same-width cards side by side was rejected as still leaving visible gaps once a
 *  region's own row count didn't happen to divide evenly across however many page-wide columns
 *  were in play) — the only question per region is how many of ITS OWN internal columns to
 *  reflow into, sized to its own row count so a sparse region (Premium Flowery) renders compact
 *  and a dense one (Low Grown) spreads wide, rather than every region sharing one fixed count. */
function estimateTppAutoCardHeight(cat: TppAutoCategory, spanCols: number, density: TppDensity): number {
  const { head: HEAD, empty: EMPTY, row: ROW, block: BLOCK, gradeGap: GRADE_GAP } = density;
  const rowCount = cat.grades.reduce((n, g) => n + g.rows.length, 0);
  if (!rowCount) return HEAD + EMPTY;
  const blockCount = new Set(cat.grades.map((g) => g.block || "")).size;
  const blockRows = blockCount > 1 ? blockCount : 0;
  const gradeGaps = Math.max(0, cat.grades.length - Math.max(blockCount, 1));
  const innerHeight = rowCount * ROW + blockRows * BLOCK + gradeGaps * GRADE_GAP;
  // Rows are atomic (can't split across a column break) — dividing by `spanCols` only
  // approximates the real reflowed height when there are enough rows to actually spread across
  // that many columns. TPP_MIN_SPAN_COLS guarantees every section uses several columns even with
  // very little data, so this cap matters in practice: a 1-row region forced into 4 columns still
  // renders at roughly one row's real height, not a quarter of one.
  const effectiveCols = Math.max(1, Math.min(spanCols, rowCount));
  return HEAD + Math.ceil(innerHeight / effectiveCols);
}

/** Target rows per internal column, and the hard floor/cap on how many a single section will ever
 *  use. A region with far more rows than the target gets several columns, up to the cap — chosen
 *  so a section's own column count is a function of ITS data, never a page-wide constant every
 *  region shares regardless of how much (or little) it actually has to show. The FLOOR matters
 *  just as much as the target: a section rendering as a single column still spans the entire page
 *  width (every section is full-width — see this file's own header comment), and `.mark`'s
 *  flex:1 (TopPriceBulletin.module.css) stretches to fill whatever's left in that column, so a
 *  sparse region with too few rows to need more than 1 column by the target alone would otherwise
 *  render as one absurdly wide row with a huge dead gap between the name and its price — verified
 *  visually on a real sale where a 4-row region did exactly that. Never dropping below the floor
 *  keeps every section's column width in the same reasonable range regardless of how little data
 *  it has. */
const TPP_ROWS_PER_COL_TARGET = 8;
const TPP_MIN_SPAN_COLS = 4;
const TPP_MAX_SPAN_COLS = 9;

/** How many internal columns this region's OWN row count calls for — sized so it reads as a
 *  reasonably full block on its own, then escalated further only if that still doesn't fit within
 *  one page's budget (the same "a single region can be too tall for any one page" problem
 *  estimateTppAutoCardHeight's own comment describes — Low Grown/Uva Medium routinely need this
 *  last-resort escalation; an ordinary region never reaches the cap by row count alone).
 *  `gradeBasisPx` is this region's own resolved grade-column width (gradeBasisFor); `widthCap`
 *  (maxColsForMarkFloor, sized to THIS region's own markLegibilityTarget) is a genuine CEILING
 *  here, not just a floor-raiser — a region whose row count alone would call for more columns
 *  than its own longest Selling Mark name can survive gets held at `widthCap` instead, even if
 *  that means its card runs taller than the row-count target assumed (the real bug this whole
 *  width-aware sizing exists to fix: a data-heavy region like Low Grown being spread across as
 *  many columns as its ROW COUNT alone suggested, truncating real 16-18 character names down to
 *  a handful of letters in the process). TPP_MIN_SPAN_COLS is still applied as a floor, but only
 *  when `widthCap` actually allows it — never forcing a sparse region wider than its own names
 *  need. Height that still doesn't fit even at `widthCap` columns is accepted (the page flow
 *  spills it to the next page) rather than narrowing columns further to force a fit — see
 *  planTppBulletinAutoFit's own `t` scan for the other half of resolving that: a denser layout
 *  shrinks both row height AND widens `widthCap` at once. */
function spanColsForRegion(cat: TppAutoCategory, density: TppDensity, gradeBasisPx: number, entry: TppRegionEntry): number {
  const rowCount = cat.grades.reduce((n, g) => n + g.rows.length, 0);
  if (!rowCount) return 1;
  const widthCap = Math.max(1, maxColsForMarkFloor(density.css, gradeBasisPx, markLegibilityTarget(entry)));
  const rowsTarget = Math.min(TPP_MAX_SPAN_COLS, Math.ceil(rowCount / TPP_ROWS_PER_COL_TARGET));
  let cols = Math.min(rowsTarget, widthCap);
  cols = Math.max(cols, Math.min(TPP_MIN_SPAN_COLS, widthCap));
  const ceiling = Math.min(TPP_MAX_SPAN_COLS, widthCap);
  while (cols < ceiling && estimateTppAutoCardHeight(cat, cols, density) > density.pageBudget) cols++;
  return cols;
}

export interface TppSection {
  entry: TppRegionEntry;
  spanCols: number;
  markMaxChars: number;
  /** This section's own resolved `.grade` column width in px (gradeBasisFor) — rendered as a
   *  per-card CSS custom-property override (TopPriceBulletin.tsx's Card) rather than baked into
   *  the shared density, so only a region with an unusually long grade code pays for the wider
   *  column. */
  gradeBasisPx: number;
}
export interface TppBulletinPage {
  sections: TppSection[];
}

/** The bulletin's own page layout — every region stacks as its own full-width section in reading
 *  order (buildRegionEntries), never split into page-wide side-by-side card columns: a page is
 *  simply as many whole sections, in order, as fit within one page's budget, spilling remaining
 *  sections onto the next page. This is deliberately a plain greedy flow, not a bin-packer —
 *  there's nothing to balance across independent columns anymore, since each section already
 *  balances its OWN internal columns to its OWN row count (spanColsForRegion). */
function planTppFullWidthLayout(entries: TppRegionEntry[], density: TppDensity): TppBulletinPage[] {
  const budget = density.pageBudget;
  const gap = density.gap;
  const pages: TppBulletinPage[] = [];
  let page: { usedHeight: number; sections: TppSection[] } = { usedHeight: 0, sections: [] };

  const closePage = () => {
    if (page.sections.length) pages.push(page);
    page = { usedHeight: 0, sections: [] };
  };

  entries.forEach((entry) => {
    const gradeBasisPx = gradeBasisFor(density.css.gradeBasis, density.css.gradeFontSize, entry.maxGradeChars);
    const spanCols = spanColsForRegion(entry.category, density, gradeBasisPx, entry);
    const height = estimateTppAutoCardHeight(entry.category, spanCols, density);
    if (page.sections.length && height + gap > budget - page.usedHeight) closePage();
    page.sections.push({ entry, spanCols, markMaxChars: tppMarkMaxCharsForCols(spanCols, density.css, gradeBasisPx), gradeBasisPx });
    page.usedHeight += height + gap;
  });
  closePage();
  return pages;
}

function layoutAt(combined: CombinedReport, t: number): { pages: TppBulletinPage[]; density: TppDensity } {
  const density = tppDensityAt(t);
  const entries = buildRegionEntries(combined, (cat) => estimateTppAutoCardHeight(cat, 1, density));
  return { pages: planTppFullWidthLayout(entries, density), density };
}

/** Whether every non-empty section in a candidate layout gives its OWN region's longest Selling
 *  Mark name enough room to render in full (markLegibilityTarget) — used by
 *  planTppBulletinAutoFit to reject a candidate `t` that would leave ANY region's names truncated,
 *  even if that candidate otherwise hits the target page count. Per-region, not one flat number:
 *  a region with only short names is never held to the same bar as one with genuinely long ones.
 *  Ignores empty regions (their "No ranked lots…" placeholder never reads markMaxChars at all). */
function allMarkNamesFitIn(pages: TppBulletinPage[]): boolean {
  for (const page of pages) {
    for (const section of page.sections) {
      if (section.entry.category.grades.length && section.markMaxChars < markLegibilityTarget(section.entry)) return false;
    }
  }
  return true;
}

/** Two-pass fit: first finds the FEWEST pages this sale's data can possibly land in (evaluated at
 *  the densest end, `t=0`, capped at TPP_MAX_PAGES) — a sale that genuinely fits on one page
 *  should never be handed a spacious-but-half-empty second page just because the most legible
 *  density happened to satisfy "<= TPP_MAX_PAGES" on its own. Then scans `t` from 1 (most
 *  spacious) down to 0 for the LARGEST — i.e. most legible — `t` that still achieves that SAME
 *  minimum page count AND lets every region's longest Selling Mark name render in full
 *  (allMarkNamesFitIn) — a page that is used gets used well (close to fully filled, and with
 *  every name actually readable) rather than stopping at the first density that merely clears the
 *  page ceiling. That second condition is usually not a trade-off against page count:
 *  `.grade`/`.at`/`.price`'s own fixed overhead shrinks FASTER than the mark font size does as `t`
 *  drops, AND spanColsForRegion's own width ceiling (widthCap) independently widens as fonts
 *  shrink, so a denser layout is usually both shorter AND more legible per column at once. A sale
 *  so large — or with names so long — it still doesn't clear both bars even at the densest end
 *  falls back to that densest result outright, rendering however many pages it genuinely needs
 *  rather than losing or hiding rows. */
export function planTppBulletinAutoFit(combined: CombinedReport): { pages: TppBulletinPage[]; density: TppDensity } {
  const densest = layoutAt(combined, 0);
  if (densest.pages.length > TPP_MAX_PAGES) return densest;
  const targetPages = densest.pages.length;

  let result = densest;
  for (let step = 0; step <= TPP_FIT_STEPS; step++) {
    const t = 1 - step / TPP_FIT_STEPS;
    const candidate = layoutAt(combined, t);
    if (candidate.pages.length <= targetPages && allMarkNamesFitIn(candidate.pages)) {
      result = candidate;
      break;
    }
  }
  return result;
}

export interface TppPage {
  cols: number;
  columns: TppRegionEntry[][];
}

/** Which entries land on which page, in which column — the one place page/column placement is
 *  decided; the Excel exporter builds straight off this. budget/maxCols default to the Excel
 *  page's own CSS-px-derived numbers; the PDF exporter passes its own real mm-based metrics
 *  instead (see exportTopPricePagePdf), so both formats still agree on WHICH cards share a page
 *  even though PDF's own heights are exact rather than estimated. */
export function planRegionPageLayout(entries: TppRegionEntry[], budget = TPP_REGION_PAGE_BUDGET, maxCols = TPP_REGION_COLUMNS): TppPage[] {
  const pageEntries: TppRegionEntry[][] = [];
  let remaining = entries;
  while (remaining.length) {
    const cols = Math.max(1, Math.min(maxCols, remaining.length));
    let cap = 1;
    packRegionColumns(remaining.slice(0, 1), cols, budget);
    for (let n = 2; n <= remaining.length; n++) {
      const attempt = packRegionColumns(remaining.slice(0, n), cols, budget);
      if (attempt.overflowed) break;
      cap = n;
    }
    pageEntries.push(remaining.slice(0, cap));
    remaining = remaining.slice(cap);
  }
  if (!pageEntries.length) return [];

  const sharedCols = bestRegionColumnCount(pageEntries[0], budget, maxCols)!.cols; // allowFallback defaults true — never null

  return pageEntries.map((pageCards) => {
    let cols = sharedCols;
    let packed = packRegionColumns(pageCards, cols, budget);
    while (packed.overflowed && cols < maxCols) {
      cols++;
      packed = packRegionColumns(pageCards, cols, budget);
    }
    const columns: TppRegionEntry[][] = Array.from({ length: cols }, () => []);
    packed.placements.forEach((p) => columns[p.col].push(p.entry));
    return { cols, columns };
  });
}

/** Every one of the 11 fixed regions gets a card, in TPP_REGION_ORDER reading order — a region
 *  the workbook had no ranked rows for still gets an empty card (matching the original's manual-
 *  card fallback) so nothing silently vanishes from the bulletin. heightFn defaults to the
 *  Excel/CSS-px estimate; the PDF exporter passes its own exact mm-based measurement instead. */
export function buildRegionEntries(combined: CombinedReport, heightFn: (cat: TppAutoCategory) => number = estimateAutoCardHeight): TppRegionEntry[] {
  const autoCategories = buildAutoCategories(combined);
  const byTitle = new Map(autoCategories.map((c) => [c.title, c]));
  const placed = new Set<string>();
  const entries: TppRegionEntry[] = [];

  const addCategory = (cat: TppAutoCategory) => {
    let maxGradeChars = 0;
    let maxMarkChars = 0;
    for (const g of cat.grades) {
      if (g.grade.length > maxGradeChars) maxGradeChars = g.grade.length;
      for (const r of g.rows) if (r.sellingMark.length > maxMarkChars) maxMarkChars = r.sellingMark.length;
    }
    entries.push({ title: cat.title, height: heightFn(cat), category: cat, maxGradeChars, maxMarkChars });
  };

  TPP_REGION_ORDER.forEach((title) => {
    const cat = byTitle.get(title) ?? { title, grades: [] };
    addCategory(cat);
    placed.add(title);
  });
  autoCategories.forEach((cat) => {
    if (!placed.has(cat.title)) addCategory(cat);
  });
  return entries;
}

const TPP_REGION_ORDER = [
  "Low Grown",
  "Premium Flowery",
  "Nuwara Eliya",
  "Udapussellawa",
  "Western High",
  "Western Medium",
  "Uva Medium",
  "Uva High",
  "CTC Teas",
  "Others — Dust",
  "Others — Off Grades",
];

// ---- EXCEL EXPORT — port of asc-studio.js's tppExcelMasthead/writeTppRegionSheet/
// writeTppExcelCard/writeTppReferenceSheet/capWrapText ---------------------------------------

const TPP_XL_GREEN = "FF2F7D52";
const TPP_XL_GREEN_DARK = "FF23603F";
const TPP_XL_GOLD = "FFB68C2A";
const TPP_XL_INK = "FF0B2545";
const TPP_XL_OURS_FILL = "FFE1F0E6";
const TPP_XL_UP = "FF1F7A4D";
const TPP_XL_HEAD_FILL = "FFEFF2F5";
const TPP_XL_MARK_COL_CHARS = 24;
const TPP_XL_LABEL_COL_CHARS = 11;
const TPP_XL_WRAP_MAX_LINES = 2;

export interface TppMeta {
  broker: string;
  auctionNumber: string;
  saleDate: string;
}

/** Truncates text (with an ellipsis) so it can never need more than maxLines wrapped lines at
 *  colChars characters per line — Excel auto-fits a wrapText cell's row height to however many
 *  lines it takes, so capping the character count here is what actually caps that height. */
function capWrapText(text: string | null | undefined, colChars: number, maxLines: number): string {
  const s = text == null ? "" : String(text);
  const max = colChars * maxLines;
  return s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s;
}

/** Writes the two-row green masthead across [startCol, endCol] (1-based, inclusive) starting at
 *  row 1. Returns the first free row underneath it. */
function writeExcelMasthead(ws: ExcelJS.Worksheet, startCol: number, endCol: number, meta: TppMeta, subtitle: string, pageLabel: string): number {
  const titleRow = ws.getRow(1);
  ws.mergeCells(1, startCol, 1, endCol);
  const titleCell = titleRow.getCell(startCol);
  titleCell.value = `${meta.broker || "Asia Siyaka Commodities PLC"}  —  ${subtitle}`;
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.alignment = { horizontal: "center", vertical: "middle" };
  titleRow.height = 22;

  const infoRow = ws.getRow(2);
  ws.mergeCells(2, startCol, 2, endCol);
  const infoCell = infoRow.getCell(startCol);
  infoCell.value = `Sale No. ${meta.auctionNumber || "—"}   ·   Sale Date ${meta.saleDate || "—"}   ·   ${pageLabel}`;
  infoCell.font = { bold: true, size: 10, color: { argb: "FFD9B44A" } };
  infoCell.alignment = { horizontal: "center", vertical: "middle" };
  infoRow.height = 16;

  for (let c = startCol; c <= endCol; c++) {
    ws.getCell(1, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_GREEN } };
    ws.getCell(2, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_GREEN_DARK } };
  }
  return 4; // row 3 left blank as a spacer
}

/** One card (a region's ranked grades, or an empty placeholder) at excel columns [base, base+3],
 *  starting at `row`. Returns the last row this card actually used. */
function writeExcelCard(ws: ExcelJS.Worksheet, entry: TppRegionEntry, base: number, row: number): number {
  const headRow = ws.getRow(row);
  ws.mergeCells(row, base, row, base + 3);
  const headCell = headRow.getCell(base);
  headCell.value = entry.category.title;
  headCell.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  headCell.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  for (let c = base; c <= base + 3; c++) {
    ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_GREEN } };
  }
  row += 1;

  const cat = entry.category;
  if (!cat.grades.length) {
    ws.mergeCells(row, base, row, base + 3);
    const cell = ws.getCell(row, base);
    cell.value = "No ranked lots for this region in the generated report.";
    cell.font = { italic: true, size: 9, color: { argb: "FF8A93A0" } };
    return row;
  }

  // Only CTC's consolidated section carries more than one block (WH / WM / L).
  const multiBlock = new Set(cat.grades.map((g) => g.block || "")).size > 1;
  let lastBlock: string | undefined;
  cat.grades.forEach((g) => {
    if (multiBlock && g.block !== lastBlock) {
      const cell = ws.getCell(row, base);
      cell.value = g.block || "Other";
      cell.font = { bold: true, size: 9, color: { argb: TPP_XL_GOLD } };
      row += 1;
      lastBlock = g.block;
    }
    g.rows.forEach((r) => {
      const markCell = ws.getCell(row, base);
      markCell.value = capWrapText(r.sellingMark, TPP_XL_MARK_COL_CHARS, TPP_XL_WRAP_MAX_LINES);
      markCell.alignment = { wrapText: true, vertical: "middle" };
      ws.getCell(row, base + 1).value = r.grade;
      const atCell = ws.getCell(row, base + 2);
      atCell.value = r.isOurs ? "@" : "";
      atCell.alignment = { horizontal: "center" };
      const priceCell = ws.getCell(row, base + 3);
      priceCell.value = r.price;
      priceCell.numFmt = "#,##0.00";
      priceCell.alignment = { horizontal: "right" };
      const font: Partial<ExcelJS.Font> = { size: 9.5 };
      if (r.isOurs) {
        font.color = { argb: TPP_XL_UP };
        font.bold = true;
        for (let c = base; c <= base + 3; c++) {
          ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_OURS_FILL } };
        }
      }
      for (let c = base; c <= base + 3; c++) ws.getCell(row, c).font = font;
      row += 1;
    });
  });
  return row - 1;
}

/** One region-cards page -> one worksheet. */
function writeRegionSheet(workbook: ExcelJS.Workbook, page: TppPage, pageIndex: number, totalPages: number, meta: TppMeta): void {
  const ws = workbook.addWorksheet(`Page ${pageIndex + 1}`, { views: [{ showGridLines: false }] });
  const FIELD_W = [24, 9, 3, 11]; // Mark, Grade, @, Price
  const GROUP_W = FIELD_W.length + 1; // + 1 gap column after each group

  for (let i = 0; i < page.cols; i++) {
    const base = i * GROUP_W + 1;
    FIELD_W.forEach((w, fi) => {
      ws.getColumn(base + fi).width = w;
    });
    ws.getColumn(base + FIELD_W.length).width = 2;
  }
  const lastCol = page.cols * GROUP_W - 1;
  const startRow = writeExcelMasthead(ws, 1, lastCol, meta, "Top Price Page", `Page ${pageIndex + 1} of ${totalPages}`);

  const cursors = new Array(page.cols).fill(startRow);
  page.columns.forEach((colEntries, i) => {
    const base = i * GROUP_W + 1;
    colEntries.forEach((entry) => {
      cursors[i] = writeExcelCard(ws, entry, base, cursors[i]) + 1; // + blank spacer row
    });
  });

  const footerRow = Math.max(...cursors, startRow) + 1;
  ws.mergeCells(footerRow, 1, footerRow, lastCol);
  const footerCell = ws.getCell(footerRow, 1);
  footerCell.value = `Asia Siyaka Commodities PLC  ·  Weekly Top Price  ·  Sale No. ${meta.auctionNumber || "—"}  ·  ${meta.saleDate || ""}`;
  footerCell.font = { italic: true, size: 9, color: { argb: "FF8A93A0" } };
  footerCell.alignment = { horizontal: "center" };
}

interface RefTable {
  headers: string[];
  rows: (string | number)[][];
  totalRow?: boolean;
}

/** Blank placeholder shells matching the original's exact table shapes — every field here is
 *  manually entered in the original (via the interactive editor, which doesn't exist yet), so
 *  these stay unfilled rather than inventing numbers. */
function referenceTables(): Record<string, RefTable> {
  return {
    orderOfSale: {
      headers: ["Category", "Lots", "Quantity"],
      rows: [
        ["Ex-Estate", "", ""],
        ["Main Sale — H&M", "", ""],
        ["Low Grown — Leafy", "", ""],
        ["Low Grown — Tippy", "", ""],
        ["Off Grades / BOP1A", "", ""],
        ["Dust", "", ""],
        ["Premium Flowery", "", ""],
        ["TOTAL", "", ""],
      ],
      totalRow: true,
    },
    sellingBrokers: {
      // 9 blank rows — matches the real number of selling brokers seen in this app's own sale
      // data (verified against data/sales/20.xlsx and 33.xlsx), so a filled-in sheet fits without
      // needing the ruled-line overflow area at all.
      headers: ["Broker", "Order", "Ex-Est.", "1°", "2°"],
      rows: Array.from({ length: 9 }, () => ["", "", "", "", ""]),
    },
    currencies: {
      headers: ["Currency", "This wk", "Prev wk"],
      rows: [
        ["GBP", "", ""],
        ["EURO", "", ""],
        ["US$", "", ""],
        ["YEN", "", ""],
      ],
    },
    saleAverages: {
      headers: ["Category", `Wk ${new Date().getFullYear()}`, `Wk ${new Date().getFullYear() - 1}`, `TD ${new Date().getFullYear()}`, `TD ${new Date().getFullYear() - 1}`],
      rows: [
        ["Uva High", "", "", "", ""],
        ["Western High", "", "", "", ""],
        ["High Grown", "", "", "", ""],
        ["Uva Medium", "", "", "", ""],
        ["Western Medium", "", "", "", ""],
        ["Medium Grown", "", "", "", ""],
        ["Low Grown", "", "", "", ""],
        ["TOTAL", "", "", "", ""],
      ],
      totalRow: true,
    },
    weeklyAverages: {
      headers: ["Category", "This wk", "Wk -1", "Wk -2", "Wk -3"],
      rows: [
        ["Uva High", "", "", "", ""],
        ["Western High", "", "", "", ""],
        ["High Grown", "", "", "", ""],
        ["Uva Medium", "", "", "", ""],
        ["Western Medium", "", "", "", ""],
        ["Medium Grown", "", "", "", ""],
        ["Low Grown", "", "", "", ""],
        ["TOTAL", "", "", "", ""],
      ],
      totalRow: true,
    },
  };
}

const CROP_NOTES: [string, string][] = [
  ["1. Western incl. Nuwara Eliya", "Weather / crop commentary — western regions."],
  ["2. Uva & Udapussellawa", "Weather / crop commentary — Uva & Udapussellawa."],
  ["3. Low grown regions", "Weather / crop commentary — low grown regions."],
];

/** The final sheet — Order of Sale, Selling Brokers, Currencies, Sale Averages, Weekly Averages
 *  and Crop & Weather, the same 3-up arrangement as the original's on-screen reference page. */
function writeReferenceSheet(workbook: ExcelJS.Workbook, meta: TppMeta, totalPages: number): void {
  const ws = workbook.addWorksheet("Reference Data", { views: [{ showGridLines: false }] });
  const PANEL_W = 6;
  const GAP_W = 1;
  const groupW = PANEL_W + GAP_W;
  const lastCol = groupW * 3 - GAP_W;
  for (let p = 0; p < 3; p++) {
    for (let c = 0; c < PANEL_W; c++) ws.getColumn(p * groupW + 1 + c).width = 11;
    ws.getColumn(p * groupW + 1 + PANEL_W).width = 2;
  }
  const startRow = writeExcelMasthead(ws, 1, lastCol, meta, "Top Price Page — Reference Data", `Page ${totalPages} of ${totalPages}`);

  const writePanel = (col: number, row: number, title: string, table: RefTable): number => {
    ws.mergeCells(row, col, row, col + PANEL_W - 1);
    const head = ws.getCell(row, col);
    head.value = title;
    head.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
    head.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
    for (let c = col; c < col + PANEL_W; c++) {
      ws.getCell(row, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_INK } };
    }
    row += 1;
    table.headers.forEach((hd, ci) => {
      const cell = ws.getCell(row, col + ci);
      cell.value = hd;
      cell.font = { bold: true, size: 8.5, color: { argb: "FF8A93A0" } };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_HEAD_FILL } };
    });
    row += 1;
    table.rows.forEach((r, ri) => {
      const isTotal = table.totalRow && ri === table.rows.length - 1;
      r.forEach((val, ci) => {
        const cell = ws.getCell(row, col + ci);
        if (ci === 0) {
          cell.value = capWrapText(String(val), TPP_XL_LABEL_COL_CHARS, TPP_XL_WRAP_MAX_LINES);
          cell.alignment = { wrapText: true, vertical: "middle" };
        } else {
          cell.value = val;
          cell.alignment = { horizontal: "right" };
        }
        if (isTotal) {
          cell.font = { bold: true, size: 9 };
          cell.border = { top: { style: "thin", color: { argb: "FF0B2545" } } };
        } else {
          cell.font = { size: 9 };
        }
      });
      row += 1;
    });
    return row;
  };

  const t = referenceTables();
  const row1 = startRow;
  const b1 = writePanel(1, row1, "Order of Sale — Offers", t.orderOfSale);
  const b2 = writePanel(1 + groupW, row1, "Selling Brokers", t.sellingBrokers);
  const b3 = writePanel(1 + groupW * 2, row1, "Currencies", t.currencies);

  const row2 = Math.max(b1, b2, b3) + 1;
  writePanel(1, row2, "Sale Averages", t.saleAverages);
  writePanel(1 + groupW, row2, "Weekly Averages", t.weeklyAverages);

  let cropRow = row2;
  ws.mergeCells(cropRow, 1 + groupW * 2, cropRow, lastCol);
  const cropHead = ws.getCell(cropRow, 1 + groupW * 2);
  cropHead.value = "Crop & Weather";
  cropHead.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" } };
  cropHead.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
  for (let c = 1 + groupW * 2; c <= lastCol; c++) {
    ws.getCell(cropRow, c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: TPP_XL_INK } };
  }
  cropRow += 1;
  CROP_NOTES.forEach(([label, seed]) => {
    ws.mergeCells(cropRow, 1 + groupW * 2, cropRow, lastCol);
    const labelCell = ws.getCell(cropRow, 1 + groupW * 2);
    labelCell.value = label;
    labelCell.font = { bold: true, size: 8.5, color: { argb: "FF8A93A0" } };
    cropRow += 1;
    ws.mergeCells(cropRow, 1 + groupW * 2, cropRow, lastCol);
    const textCell = ws.getCell(cropRow, 1 + groupW * 2);
    textCell.value = seed;
    textCell.font = { size: 9 };
    textCell.alignment = { wrapText: true, vertical: "top" };
    cropRow += 1;
  });
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

/** Extracts a bare sale number from sourceName ("Sale 30 - 2026" -> "30"), same convention as
 *  combinedReportExport.ts. */
function extractSaleNumber(sourceName: string): string {
  const m = /Sale\s+(\d+)/i.exec(sourceName);
  return m ? m[1] : sourceName;
}

/** No standalone sale-date field exists yet (that's a manually-entered field in the original,
 *  via the editor) — sourceName carries the sale's identity ("Sale 30 - 2026") for both the
 *  number and, in place of a bare date, the masthead's own display text. Shared by both exports
 *  so their mastheads always agree. */
export function buildTppMeta(combined: CombinedReport, referenceReport?: AuctionReport): TppMeta {
  return {
    broker: "Asia Siyaka Commodities PLC",
    auctionNumber: extractSaleNumber((referenceReport ?? combined.reports[0])?.sourceName ?? combined.sourceName),
    saleDate: combined.sourceName,
  };
}

export async function exportTopPricePageExcel(combined: CombinedReport, referenceReport?: AuctionReport): Promise<void> {
  const meta = buildTppMeta(combined, referenceReport);

  const entries = buildRegionEntries(combined);
  const layout = planRegionPageLayout(entries);
  if (!layout.length) throw new Error("Nothing to export — no ranked rows in this sale.");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Asia Siyaka Commodities";
  workbook.created = new Date();

  const totalPages = layout.length + 1;
  layout.forEach((page, i) => writeRegionSheet(workbook, page, i, totalPages, meta));
  writeReferenceSheet(workbook, meta, totalPages);

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `top-price-page-sale-${meta.auctionNumber || "draft"}-${dateStamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- PDF EXPORT ------------------------------------------------------------------------------
// Matches the original tool's own approach exactly: the bulletin is a real on-screen DOM
// component (TopPriceBulletin.tsx, driven by planTppBulletinAutoFit + the banded layout above),
// and exportTopPricePagePdf screenshots each already-rendered page (html2canvas) into the PDF —
// see that function's own doc comment. No vector-drawing left here at all; colors/fonts for the
// bulletin itself live in TopPriceBulletin.module.css, matching the original's actual on-screen
// theme (asc-components.css §K2 / asc-tokens.css's default "asia-siyaka" theme) — not the Excel
// exporter's own separately-hardcoded TPP_XL_* palette below, which was already independently
// styled in the original (Excel's Reference Data panels use navy; the bulletin uses forest
// green, both intentional).

/** Screenshots each already-rendered `.page` DOM node (TopPriceBulletin.tsx) into a JPEG and
 *  stitches those into a multi-page PDF — exactly the original report-studio.js tool's own
 *  exportPDF(): every page's PDF size comes from that page's OWN captured pixel dimensions
 *  (converted 1 CSS px = 72/96 pt, dividing back out the 2x oversampling), not a fixed A4
 *  constant, so the export always matches whatever actually rendered instead of assuming a
 *  physical size the banded layout only ever *targets*. JPEG (not PNG) at high quality for the
 *  same reason the original adopted it: a 2x PNG of this dense a bulletin ran 60MB+ in testing;
 *  a 0.95-quality JPEG is visually indistinguishable at print/viewing scale and an order of
 *  magnitude smaller. There is no separate Reference Data page here — the original's own
 *  exportPDF only ever captures the ranked-region bulletin pages themselves (Excel is the only
 *  format with a Reference Data sheet — see writeReferenceSheet). */
export async function exportTopPricePagePdf(pageElements: HTMLElement[], meta: TppMeta): Promise<void> {
  if (pageElements.length === 0) throw new Error("No bulletin pages to export — generate the report first.");

  const { default: html2canvas } = await import("html2canvas");
  // 3x, not the original tool's 2x — this bulletin's own type runs smaller (compact density's
  // 7-8px rows) than what the original ever had to capture, and text at that size visibly
  // softened under html2canvas at 2x (reported as "not clear as the preview"). 3x costs a
  // larger JPEG but is still an order of magnitude under the PNG size that pushed the original
  // to JPEG in the first place.
  const CAPTURE_SCALE = 3;
  const JPEG_QUALITY = 0.95;

  // Web fonts (Fraunces/IBM Plex Mono, layout.tsx) must have actually finished loading before
  // capture — html2canvas paints whatever font is resolved at that exact instant, and a capture
  // that beats the font swap silently falls back to the browser's generic serif/monospace,
  // which is a second, independent reason exported text looked different from the preview
  // (the preview had strictly more time to finish loading them before anyone looked at it).
  await document.fonts.ready;

  // One frame so freshly laid-out content (e.g. a page whose density/catalogue just changed,
  // or a page scrolled into view for the first time) has actually painted before capture —
  // the original tool's own exportPDF() does the same wait for the same reason. Skipping this
  // is what produces html2canvas's "canvas element with a width or height of 0" error: it
  // measures an element mid-layout, before the browser has given it real dimensions.
  await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));

  let doc: jsPDF | null = null;
  for (const [pageIndex, el] of pageElements.entries()) {
    // Diagnostic-only: log (never throw on) any descendant whose own rendered box is 0 in
    // either dimension, since that's exactly what makes html2canvas's internal gradient/clip
    // canvases end up 0-sized too ("canvas element with a width or height of 0" — the error
    // this is here to actually pin down instead of guessing again). Left in permanently; it's
    // silent unless something really is 0-sized, in which case this is the fastest way to find
    // out which element and why.
    const rect = el.getBoundingClientRect();
    const zeroSized: string[] = [];
    el.querySelectorAll("*").forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) {
        zeroSized.push(`<${node.tagName.toLowerCase()} class="${(node as HTMLElement).className}"> ${r.width}x${r.height} text="${(node.textContent ?? "").slice(0, 30)}"`);
      }
    });
    console.info(
      `[exportTopPricePagePdf] page ${pageIndex + 1}/${pageElements.length}: ${rect.width}x${rect.height}` +
        (zeroSized.length ? `, ${zeroSized.length} zero-sized descendant(s):\n  ${zeroSized.slice(0, 20).join("\n  ")}` : ", no zero-sized descendants")
    );

    let canvas: HTMLCanvasElement;
    try {
      // foreignObjectRendering:true (delegating paint to an inline SVG <foreignObject> instead
      // of html2canvas's own JS re-implementation of layout/text) was tried here to fix the
      // Selling Mark column's glyph-clipping below — it made it worse, producing a fully blank
      // captured page instead, so it's deliberately NOT used. Left off; see .mark's own CSS
      // fix in TopPriceBulletin.module.css for how the actual clipping got fixed instead.
      canvas = await html2canvas(el, { scale: CAPTURE_SCALE, backgroundColor: "#FCFBF8", useCORS: true });
    } catch (err) {
      console.error(`[exportTopPricePagePdf] html2canvas threw on page ${pageIndex + 1}/${pageElements.length} (rect ${rect.width}x${rect.height}):`, err);
      throw err;
    }
    const dataUrl = canvas.toDataURL("image/jpeg", JPEG_QUALITY);
    const wPt = (canvas.width / CAPTURE_SCALE) * (72 / 96);
    const hPt = (canvas.height / CAPTURE_SCALE) * (72 / 96);
    const orientation = wPt > hPt ? "landscape" : "portrait";
    if (!doc) {
      doc = new jsPDF({ unit: "pt", format: [wPt, hPt], orientation });
    } else {
      doc.addPage([wPt, hPt], orientation);
    }
    doc.addImage(dataUrl, "JPEG", 0, 0, wPt, hPt);
  }

  doc!.save(`top-price-page-sale-${meta.auctionNumber || "draft"}-${dateStamp()}.pdf`);
}
