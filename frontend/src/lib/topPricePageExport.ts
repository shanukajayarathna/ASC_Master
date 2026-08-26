"use client";

/* =====================================================================
   TOP PRICE PAGE — the executive bulletin combining every ranked region
   (Low Grown through CTC Teas) from all four Combined Report families
   into one document. Port of the original standalone app's
   asc-analytics.js (topPricePage/regionForItem — the region grouping)
   and asc-studio.js (packTppRegionColumns/planTppRegionPageLayout/
   TPP_DENSITY_PRESETS — the masonry page-packing + density-auto-fit
   algorithm, shared by Excel, the on-screen bulletin, AND the PDF —
   plus the Excel writer itself: tppExcelMasthead/writeTppRegionSheet/
   writeTppExcelCard/writeTppReferenceSheet).

   The on-screen bulletin itself is TopPriceBulletin.tsx (a real DOM
   component, not built here) — this file supplies the layout (
   planTppBulletinAutoFit) it renders from, and exportTopPricePagePdf
   screenshots that rendered DOM into the PDF exactly like the original
   tool's own exportPDF does (html2canvas), rather than redrawing it a
   second time as vector PDF.

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
 *  bulletin's density auto-fit (planTppRegionBandedLayout below) passes its own preset-scoped
 *  height function and gap instead, so this one packer serves both callers exactly like the
 *  original report-studio.js tool's own packTppRegionColumns does. */
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

function bestRegionColumnCount(
  pageCards: TppRegionEntry[],
  budget: number,
  maxCols: number,
  allowFallback = true,
  getHeight?: (e: TppRegionEntry) => number,
  gap?: number
): { packed: PackResult; cols: number; fill: number } | null {
  let best: { packed: PackResult; fill: number; cols: number } | null = null;
  for (let cols = 1; cols <= Math.min(maxCols, pageCards.length); cols++) {
    const packed = packRegionColumns(pageCards, cols, budget, getHeight, gap);
    if (packed.overflowed) continue;
    const fill = Math.max(...packed.heights);
    if (!best || fill > best.fill || (fill === best.fill && cols > best.cols)) best = { packed, fill, cols };
  }
  if (!best && allowFallback) {
    const cols = Math.min(maxCols, pageCards.length);
    const packed = packRegionColumns(pageCards, cols, budget, getHeight, gap);
    best = { packed, fill: Math.max(...packed.heights), cols };
  }
  return best;
}

// ---- BULLETIN BANDED LAYOUT — port of asc-studio.js's TPP_DENSITY_PRESETS/
// estimateTppAutoCardHeight/planTppRegionBandedLayout/planTppRegionBandedLayoutAutoFit. This is
// what the on-screen bulletin (TopPriceBulletin.tsx) and the PDF export (a screenshot of that
// same DOM) both actually render — a categorically different shape from Excel's own
// planRegionPageLayout above (which stays untouched): every region here gets classified once by
// its own single-column height, "small" regions get LPT-packed into a narrow 3-column grid band
// (exactly like Excel's masonry), but a "big" region instead gets the FULL page width as its own
// wide band, relying on .asc-tpp-body's native CSS `columns:` to reflow its own row list into
// several reading columns — see TopPriceBulletin.module.css. Bands stack top to bottom in
// reading order; a page closes once the next band would overflow its budget. */

/** Narrow-grid column count for the bulletin — fixed regardless of density (a mark name must
 *  still read on one line at this page's physical width; a smaller font doesn't change that),
 *  unlike a wide band's own reflow column count (`wideCols` below), which a smaller font DOES
 *  let stretch further since it already has the whole sheet width to itself. */
const TPP_BULLETIN_COLUMNS = 3;

/** How much card height ONE bulletin page can actually hold, at "normal" density — budgeted
 *  under the true printable area (see report-studio.js's own TPP_REGION_PAGE_BUDGET comment)
 *  since both this number and estimateTppAutoCardHeight are estimates, not measured layout, and
 *  a card spilling onto an unrelated page is a far worse failure than some blank space left at
 *  the foot of a page that had room to spare. */
const TPP_BULLETIN_PAGE_BUDGET = 520;

/** The bulletin's own fixed page-count target — a TARGET, not a hard ceiling: a sale so large it
 *  still doesn't fit even at "ultra" (the densest preset) gets however many pages it genuinely
 *  needs rather than losing rows. */
export const TPP_MAX_PAGES = 2;

/** One row-metric preset the density auto-fit tries in order. Every field here has a matching
 *  CSS number under `.asc-tpp-bulletin[data-density]` in TopPriceBulletin.module.css — the two
 *  must move together, or this file's page-count estimate and what actually renders disagree. */
export interface TppDensity {
  name: "normal" | "compact" | "ultra";
  head: number;
  empty: number;
  row: number;
  block: number;
  gradeGap: number;
  /** Reflow column count a WIDE band's own card computes to via CSS `columns:` — independent of
   *  TPP_BULLETIN_COLUMNS (the narrow grid band's column count). */
  wideCols: number;
  pageBudget: number;
  gap: number;
  /** Max Selling Mark characters before a JS-truncated ellipsis kicks in (TopPriceBulletin.tsx's
   *  Row) — NOT CSS text-overflow/overflow:hidden, which is what caused the vertical glyph-
   *  clipping bug in html2canvas exports (see .mark's own CSS comment). Truncating the actual
   *  string is the only safe way to bound a name's rendered width at these densities: without it,
   *  a name that only slightly overflows visually collides with the grade/price columns instead
   *  of being clipped, since .mark has no overflow:hidden to hide the excess. Sized conservatively
   *  for the narrowest column width this density can actually produce (a small-region grid card
   *  packed 3-wide, each further reflowed by its own `columns:` CSS, is tighter than a wide-band
   *  card's own per-column width — verified by measuring real rendered rects, not guessed). */
  markMaxChars: number;
}

export const TPP_DENSITY_NORMAL: TppDensity = {
  name: "normal",
  head: 26,
  empty: 38,
  row: 18,
  block: 24,
  gradeGap: 6,
  wideCols: 3,
  pageBudget: TPP_BULLETIN_PAGE_BUDGET,
  gap: 10,
  markMaxChars: 34,
};

export const TPP_DENSITY_COMPACT: TppDensity = {
  name: "compact",
  head: 15,
  empty: 22,
  row: 11,
  block: 13,
  gradeGap: 2,
  wideCols: 5,
  pageBudget: 660,
  gap: 6,
  markMaxChars: 22,
};

/** Last-resort preset — real sale data regularly runs 220-320 ranked rows, and "compact" alone
 *  still overflows 2 pages for roughly a third of them. Squeezes spacing (padding/margins/gaps)
 *  harder than font size, since legibility matters more than density once type is already this
 *  small — see the matching CSS block's own comment for the same reasoning applied per-property. */
export const TPP_DENSITY_ULTRA: TppDensity = {
  name: "ultra",
  head: 11,
  empty: 16,
  row: 8,
  block: 9,
  gradeGap: 1,
  wideCols: 7,
  pageBudget: 780,
  gap: 4,
  markMaxChars: 13,
};

/** The narrow (spanCols:1) height a region would render to at this density — what classifies it
 *  small/big and what the small-entries grid band packs by. `spanCols` estimates the SAME card
 *  reflowed into that many of its own reading columns instead (a wide band's actual shape) —
 *  only the row-driven inner height divides by it; HEAD spans the full band width regardless. */
function estimateTppAutoCardHeight(cat: TppAutoCategory, spanCols: number, density: TppDensity): number {
  const { head: HEAD, empty: EMPTY, row: ROW, block: BLOCK, gradeGap: GRADE_GAP } = density;
  const rowCount = cat.grades.reduce((n, g) => n + g.rows.length, 0);
  if (!rowCount) return HEAD + EMPTY;
  const blockCount = new Set(cat.grades.map((g) => g.block || "")).size;
  const blockRows = blockCount > 1 ? blockCount : 0;
  const gradeGaps = Math.max(0, cat.grades.length - Math.max(blockCount, 1));
  const innerHeight = rowCount * ROW + blockRows * BLOCK + gradeGaps * GRADE_GAP;
  return HEAD + Math.ceil(innerHeight / spanCols);
}

export type TppBand = { kind: "wide"; entry: TppRegionEntry } | { kind: "grid"; columns: TppRegionEntry[][] };
export interface TppBulletinPage {
  bands: TppBand[];
}

/** The bulletin's own page/band decision — see this section's header comment for why it's a
 *  categorically different shape from Excel's narrow-only planRegionPageLayout. */
function planTppRegionBandedLayout(entries: TppRegionEntry[], density: TppDensity): TppBulletinPage[] {
  const budget = density.pageBudget;
  const maxCols = TPP_BULLETIN_COLUMNS;
  const gap = density.gap;
  const bigThreshold = budget / maxCols;
  const narrowHeight = (entry: TppRegionEntry) => estimateTppAutoCardHeight(entry.category, 1, density);
  const isBig = (entry: TppRegionEntry) => narrowHeight(entry) > bigThreshold;

  const pages: TppBulletinPage[] = [];
  let page: { usedHeight: number; bands: TppBand[] } = { usedHeight: 0, bands: [] };
  let smallBuf: TppRegionEntry[] = [];

  const roomLeft = () => budget - page.usedHeight;
  const fitSmalls = (list: TppRegionEntry[], room: number) => bestRegionColumnCount(list, room, maxCols, false, narrowHeight, gap);

  const closeSmallBand = () => {
    if (!smallBuf.length) return;
    const best = fitSmalls(smallBuf, roomLeft())!; // always fits — see the original tool's own note on this invariant
    const columns: TppRegionEntry[][] = Array.from({ length: best.cols }, () => []);
    best.packed.placements.forEach((p) => columns[p.col].push(p.entry));
    page.bands.push({ kind: "grid", columns });
    page.usedHeight += best.fill + gap;
    smallBuf = [];
  };

  const closePage = () => {
    closeSmallBand();
    if (page.bands.length) pages.push(page);
    page = { usedHeight: 0, bands: [] };
  };

  entries.forEach((entry) => {
    if (isBig(entry)) {
      closeSmallBand();
      const height = estimateTppAutoCardHeight(entry.category, density.wideCols, density);
      if (page.bands.length && height + gap > roomLeft()) closePage();
      page.bands.push({ kind: "wide", entry });
      page.usedHeight += height + gap;
      return;
    }
    const candidate = [...smallBuf, entry];
    if (fitSmalls(candidate, roomLeft())) {
      smallBuf = candidate;
    } else {
      closePage();
      smallBuf = [entry];
    }
  });
  closePage();
  return pages;
}

/** Tries TPP_DENSITY_PRESETS (normal -> compact -> ultra, lightest type first) and hands back the
 *  first whose page count is within TPP_MAX_PAGES, or ultra's own result if even that doesn't get
 *  there. Re-running the layout per preset is cheap (pure arithmetic over a dozen-ish entries),
 *  so trying every preset up front costs nothing a normal-sized sale would ever feel. */
const TPP_DENSITY_PRESETS = [TPP_DENSITY_NORMAL, TPP_DENSITY_COMPACT, TPP_DENSITY_ULTRA];

export function planTppBulletinAutoFit(combined: CombinedReport): { pages: TppBulletinPage[]; density: TppDensity } {
  let result: { pages: TppBulletinPage[]; density: TppDensity } | null = null;
  for (const density of TPP_DENSITY_PRESETS) {
    const entries = buildRegionEntries(combined, (cat) => estimateTppAutoCardHeight(cat, 1, density));
    const pages = planTppRegionBandedLayout(entries, density);
    result = { pages, density };
    if (pages.length <= TPP_MAX_PAGES || density === TPP_DENSITY_PRESETS[TPP_DENSITY_PRESETS.length - 1]) break;
  }
  return result!;
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
    entries.push({ title: cat.title, height: heightFn(cat), category: cat });
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
  footerCell.value = `Asia Siyaka Commodities PLC  ·  Weekly Top Price Bulletin  ·  Sale No. ${meta.auctionNumber || "—"}  ·  ${meta.saleDate || ""}`;
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
