"use client";

/* =====================================================================
   TOP PRICE PAGE — the executive bulletin combining every ranked region
   (Low Grown through CTC Teas) from all four Combined Report families
   into one document. Port of the original standalone app's
   asc-analytics.js (topPricePage/regionForItem — the region grouping)
   and asc-studio.js (packTppRegionColumns/planTppRegionPageLayout — the
   masonry page-packing algorithm shared by Excel and PDF — plus the
   Excel writer itself: tppExcelMasthead/writeTppRegionSheet/
   writeTppExcelCard/writeTppReferenceSheet).

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
  overflowed: boolean;
}

/** LPT ("Longest Processing Time") bin-packing: cards assigned largest-first to whichever
 *  column is currently shortest — a standard, well-bounded heuristic (worst case within 4/3 of
 *  optimal) that avoids a big card landing on top of a column already loaded with other big
 *  cards. Region reading order is unaffected — only which column each card renders in. */
function packRegionColumns(pageEntries: TppRegionEntry[], cols: number, budget: number): PackResult {
  const heights = new Array(cols).fill(0);
  const colOf = new Map<TppRegionEntry, number>();
  [...pageEntries]
    .sort((a, b) => b.height - a.height)
    .forEach((entry) => {
      let col = 0;
      for (let c = 1; c < cols; c++) if (heights[c] < heights[col]) col = c;
      const gapBefore = heights[col] > 0 ? 10 : 0;
      heights[col] += gapBefore + entry.height;
      colOf.set(entry, col);
    });
  const placements = pageEntries.map((entry) => ({ entry, col: colOf.get(entry)! }));
  return { placements, heights, overflowed: heights.some((h) => h > budget) };
}

function bestRegionColumnCount(pageCards: TppRegionEntry[], budget: number, maxCols: number): { packed: PackResult; cols: number } {
  let best: { packed: PackResult; fill: number; cols: number } | null = null;
  for (let cols = 1; cols <= Math.min(maxCols, pageCards.length); cols++) {
    const packed = packRegionColumns(pageCards, cols, budget);
    if (packed.overflowed) continue;
    const fill = Math.max(...packed.heights);
    if (!best || fill > best.fill || (fill === best.fill && cols > best.cols)) best = { packed, fill, cols };
  }
  if (!best) {
    const cols = Math.min(maxCols, pageCards.length);
    const packed = packRegionColumns(pageCards, cols, budget);
    best = { packed, fill: Math.max(...packed.heights), cols };
  }
  return best;
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

  const sharedCols = bestRegionColumnCount(pageEntries[0], budget, maxCols).cols;

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
  "Others — Dust",
  "Others — Off Grades",
  "Uva Medium",
  "Uva High",
  "CTC Teas",
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
function buildTppMeta(combined: CombinedReport, referenceReport?: AuctionReport): TppMeta {
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
// The original builds its PDF by screenshotting the on-screen bulletin (html2canvas) — that DOM/
// CSS bulletin doesn't exist here (it lives inside the interactive editor, not yet built), so
// this draws the same document directly as vector PDF instead. That's a genuine technology swap,
// but it buys something the screenshot approach can't: every row height below is the EXACT size
// this code is about to draw, not an estimate of what a browser might render — so pages pack
// densely with no leftover blank space, which the original itself explicitly accepted as a
// tradeoff ("a little extra blank space... is a far worse outcome than [a card] spilling").
// Colors/fonts match the original's actual on-screen theme (asc-components.css §K2 / asc-
// tokens.css's default "asia-siyaka" theme), not the Excel exporter's own separately-hardcoded
// TPP_XL_* palette — the two were already independently styled in the original (Excel's
// Reference Data panels use navy; the on-screen/PDF ones use forest green, both intentional).

const PDF_INK: [number, number, number] = [18, 71, 52]; // #124734 — --asc-forest, this theme's --navy
const PDF_PAPER: [number, number, number] = [252, 251, 248]; // #FCFBF8
const PDF_HEADER_1: [number, number, number] = [47, 125, 82]; // #2F7D52
const PDF_HEADER_2: [number, number, number] = [62, 148, 104]; // #3E9468
const PDF_GOLD: [number, number, number] = [182, 140, 42]; // #B68C2A
const PDF_GOLD_SOFT: [number, number, number] = [217, 180, 74]; // #D9B44A
const PDF_UP: [number, number, number] = [31, 122, 77]; // #1F7A4D
const PDF_OURS_FILL: [number, number, number] = [225, 240, 230]; // #E1F0E6
const PDF_FAINT: [number, number, number] = [139, 146, 158]; // #8B929E
const PDF_HEAD_FILL: [number, number, number] = [239, 242, 245]; // #EFF2F5
const PDF_GRADE_RULE: [number, number, number] = [196, 191, 178]; // divider between grade groups — deliberately more visible than the reference page's hairlines

// A3 landscape, matching the original's --asc-page-w:420mm bulletin page size exactly.
const PDF_PAGE_W = 420;
const PDF_PAGE_H = 297;
const PDF_MARGIN = 10;
const PDF_MASTHEAD_H = 20;
const PDF_FOOTER_H = 9;
const PDF_GAP_V = 4;
const PDF_COL_GAP = 5;
const PDF_BODY_W = PDF_PAGE_W - 2 * PDF_MARGIN;
const PDF_BODY_H = PDF_PAGE_H - 2 * PDF_MARGIN - PDF_MASTHEAD_H - PDF_FOOTER_H - 2 * PDF_GAP_V;

const PDF_ROW_H = 4.3;
const PDF_CARD_HEAD_H = 6.5;
const PDF_BLOCK_H = 5;
const PDF_GRADE_GAP = 1.6;
const PDF_EMPTY_H = 12;

// ---- ROW-LEVEL FLOWING LAYOUT ---------------------------------------------------------------
// Region "cards" (as used by Excel, and by the PDF's first attempt) are an indivisible unit —
// a region with 20 grades and a region with 2 can never be split to balance a column, which is a
// hard mathematical ceiling on how even any card-level packing can ever get. This instead treats
// every region header, block divider and price row as its own small flowing item, and divides
// that flat list into columns by cumulative HEIGHT — the same technique a newspaper uses to
// carry a long article across several columns. A region whose rows straddle a column break just
// continues at the top of the next column with a small repeated header, and the imbalance this
// leaves is bounded by the height of ONE row (a few mm), not the height of a whole region.

interface FlowItem {
  kind: "region" | "block" | "row" | "empty";
  height: number; // natural (scale 1) height this item occupies when drawn
  regionTitle?: string;
  blockLabel?: string;
  row?: RankedLotRow;
  emptyMessage?: string;
  gradeStart?: boolean; // true on a row that's the first of a new grade/price-level group
}

/** Flattens every region (in the same TPP_REGION_ORDER reading order buildRegionEntries uses)
 *  into one ordered list of drawable items. */
function buildFlowItems(combined: CombinedReport): FlowItem[] {
  const autoCategories = buildAutoCategories(combined);
  const byTitle = new Map(autoCategories.map((c) => [c.title, c]));
  const placed = new Set<string>();
  const items: FlowItem[] = [];

  const addCategory = (cat: TppAutoCategory) => {
    items.push({ kind: "region", height: PDF_CARD_HEAD_H, regionTitle: cat.title });
    if (!cat.grades.length) {
      items.push({ kind: "empty", height: PDF_EMPTY_H, emptyMessage: "No ranked lots for this region in the generated report." });
      return;
    }
    const multiBlock = new Set(cat.grades.map((g) => g.block || "")).size > 1;
    let lastBlock: string | undefined;
    cat.grades.forEach((g) => {
      if (multiBlock && g.block !== lastBlock) {
        items.push({ kind: "block", height: PDF_BLOCK_H, blockLabel: g.block || "OTHER" });
        lastBlock = g.block;
      }
      g.rows.forEach((r, idx) => {
        items.push({ kind: "row", height: PDF_ROW_H + (idx === 0 ? PDF_GRADE_GAP : 0), row: r, gradeStart: idx === 0 });
      });
    });
  };

  TPP_REGION_ORDER.forEach((title) => {
    addCategory(byTitle.get(title) ?? { title, grades: [] });
    placed.add(title);
  });
  autoCategories.forEach((cat) => {
    if (!placed.has(cat.title)) addCategory(cat);
  });

  return items;
}

/** Divides the flat item list into as many fixed-width columns as the content actually needs —
 *  a page is no longer a hard constraint to shrink into, so every row and header draws at one
 *  fixed, comfortable, always-legible size (no per-sale scale factor at all). Breaks as close to
 *  `perColHeight` as possible without ever splitting a single row/header in half; a region (and,
 *  if relevant, its current block) whose rows straddle a break repeats a small header at the top
 *  of the next column, so a reader arriving mid-column never loses context. Returns a flat list
 *  of columns — grouping those into pages is a separate step (see groupColumnsIntoPages), so how
 *  many columns land on a page never has to distort how evenly the columns themselves split. */
function splitFlowColumns(items: FlowItem[], perColHeight: number): FlowItem[][] {
  const columns: FlowItem[][] = [];
  let current: FlowItem[] = [];
  let currentHeight = 0;
  let activeRegion: string | null = null;
  let activeBlock: string | null = null;

  const continuationHeaders = (): FlowItem[] => {
    if (!activeRegion) return [];
    const headers: FlowItem[] = [{ kind: "region", height: PDF_CARD_HEAD_H, regionTitle: `${activeRegion} (cont'd)` }];
    if (activeBlock) headers.push({ kind: "block", height: PDF_BLOCK_H, blockLabel: activeBlock });
    return headers;
  };

  const startNewColumn = () => {
    columns.push(current);
    current = [];
    currentHeight = 0;
    continuationHeaders().forEach((h) => {
      current.push(h);
      currentHeight += h.height;
    });
  };

  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];

    // A header (region/block) that fits but whose very next line doesn't is a widow — it would
    // sit alone at the bottom of a column with its actual content starting fresh (behind a
    // redundant "(cont'd)" repeat) on the next one. Requiring the header to bring at least that
    // first line along when deciding whether it fits pushes the whole header+line pair to the
    // next column together instead, so a reader is never left staring at a bare title.
    let requiredHeight = item.height;
    if (item.kind === "region" || item.kind === "block") {
      const next = items[idx + 1];
      if (next && next.kind !== "region") requiredHeight += next.height;
    }

    // The break check (and the continuation header it triggers) must run BEFORE activeRegion/
    // activeBlock are updated to THIS item's own title — startNewColumn()'s continuationHeaders()
    // describes whatever was active going into this item, i.e. what's actually being continued.
    // Updating first (as an earlier version of this loop did) meant that when the widowed item
    // was itself a region/block header, the synthesized "<title> (cont'd)" header described that
    // same not-yet-placed header instead of the real previous one — producing a duplicate
    // "<Title> (cont'd)" immediately followed by the real "<Title>" header right below it.
    if (currentHeight + requiredHeight > perColHeight && current.length > 0) startNewColumn();

    if (item.kind === "region") {
      activeRegion = item.regionTitle ?? null;
      activeBlock = null;
    } else if (item.kind === "block") {
      activeBlock = item.blockLabel ?? null;
    }

    current.push(item);
    currentHeight += item.height;
  }
  if (current.length) columns.push(current);
  return columns;
}

/** How many columns each page should get so `total` columns divide across `numPages` pages as
 *  evenly as possible (e.g. 10 columns over 3 pages → 4/3/3, never the lopsided 4/4/2 that
 *  chunking sequentially by a fixed page width would produce) — any remainder is spread across
 *  the FIRST pages one column at a time rather than piling it all onto whichever page is left
 *  over last. */
function evenPageSizes(total: number, numPages: number): number[] {
  const base = Math.floor(total / numPages);
  const remainder = total % numPages;
  return Array.from({ length: numPages }, (_, i) => base + (i < remainder ? 1 : 0));
}

function groupColumnsIntoPages(columns: FlowItem[][], pageSizes: number[]): FlowItem[][][] {
  const pages: FlowItem[][][] = [];
  let cursor = 0;
  pageSizes.forEach((size) => {
    pages.push(columns.slice(cursor, cursor + size));
    cursor += size;
  });
  return pages;
}

/** Truncates text (with an ellipsis) to fit maxWidth at the doc's current font — mirrors the
 *  CSS's text-overflow:ellipsis on .asc-tpp-mark, since jsPDF draws text as-is with no wrapping
 *  or clipping of its own. */
function fitText(doc: jsPDF, text: string, maxWidth: number): string {
  const s = text ?? "";
  if (doc.getTextWidth(s) <= maxWidth) return s;
  let lo = 0,
    hi = s.length;
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (doc.getTextWidth(`${s.slice(0, mid)}…`) <= maxWidth) lo = mid;
    else hi = mid - 1;
  }
  return lo > 0 ? `${s.slice(0, lo)}…` : "…";
}

function drawMasthead(doc: jsPDF, meta: TppMeta, subtitle: string, pageLabel: string): number {
  const x = PDF_MARGIN,
    y = PDF_MARGIN,
    w = PDF_BODY_W,
    h = PDF_MASTHEAD_H;
  doc.setFillColor(...PDF_HEADER_1);
  doc.rect(x, y, w, h * 0.62, "F");
  doc.setFillColor(...PDF_HEADER_2);
  doc.rect(x, y + h * 0.62, w, h * 0.38, "F");

  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(meta.broker || "Asia Siyaka Commodities PLC", x + 6, y + 9);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_GOLD_SOFT);
  doc.text(subtitle.toUpperCase(), x + 6, y + 15.5);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.setTextColor(255, 255, 255);
  doc.text(`SALE NO. ${meta.auctionNumber || "—"}`, x + w - 6, y + 9, { align: "right" });
  doc.setFontSize(8);
  doc.text(pageLabel.toUpperCase(), x + w - 6, y + 15.5, { align: "right" });

  return y + h + PDF_GAP_V;
}

function drawFooter(doc: jsPDF, meta: TppMeta): void {
  const y = PDF_PAGE_H - PDF_MARGIN - PDF_FOOTER_H;
  doc.setDrawColor(...PDF_GOLD);
  doc.setLineWidth(0.3);
  doc.line(PDF_MARGIN, y, PDF_MARGIN + PDF_BODY_W * 0.32, y);
  doc.line(PDF_PAGE_W - PDF_MARGIN - PDF_BODY_W * 0.32, y, PDF_PAGE_W - PDF_MARGIN, y);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.setTextColor(...PDF_GOLD);
  const text = `${meta.broker || "Asia Siyaka Commodities PLC"}   ·   Weekly Top Price Bulletin   ·   Sale No. ${meta.auctionNumber || "—"}   ·   ${meta.saleDate || ""}`;
  doc.text(text.toUpperCase(), PDF_PAGE_W / 2, y + 5, { align: "center" });
}

/** Draws one column's worth of the flowing item list top to bottom, at one fixed, always-legible
 *  size — no per-sale scale factor. `extraGapPerRegion` distributes whatever small amount of
 *  slack this particular column has left (see drawFlowPage) as breathing room between its own
 *  regions, so a lightly-filled column still reads as deliberately spaced rather than short. */
function drawFlowColumn(doc: jsPDF, items: FlowItem[], x: number, y: number, w: number, extraGapPerRegion: number): void {
  const markW = w * 0.5;
  const gradeW = w * 0.24;
  const atW = w * 0.08;
  let cy = y;
  let firstItem = true;
  let prevKind: FlowItem["kind"] | null = null;

  items.forEach((item) => {
    if (item.kind === "region" && !firstItem) cy += extraGapPerRegion;
    firstItem = false;

    switch (item.kind) {
      case "region": {
        const h = PDF_CARD_HEAD_H;
        doc.setFillColor(...PDF_HEADER_1);
        doc.rect(x, cy, w, h, "F");
        doc.setTextColor(255, 255, 255);
        doc.setFont("helvetica", "bold");
        doc.setFontSize(8.5);
        doc.text((item.regionTitle ?? "").toUpperCase(), x + 3, cy + h / 2 + 1.3);
        cy += h;
        break;
      }
      case "block": {
        const h = PDF_BLOCK_H;
        doc.setFillColor(...PDF_PAPER);
        doc.rect(x, cy, w, h, "F");
        doc.setFont("courier", "bold");
        doc.setFontSize(7);
        doc.setTextColor(...PDF_GOLD);
        doc.text((item.blockLabel ?? "").toUpperCase(), x + 3, cy + h - 1.4);
        cy += h;
        break;
      }
      case "empty": {
        const h = PDF_EMPTY_H;
        doc.setFillColor(...PDF_PAPER);
        doc.rect(x, cy, w, h, "F");
        doc.setFont("helvetica", "italic");
        doc.setFontSize(7.5);
        doc.setTextColor(...PDF_FAINT);
        doc.text(fitText(doc, item.emptyMessage ?? "", w - 6), x + 3, cy + 6);
        cy += h;
        break;
      }
      case "row": {
        const r = item.row!;
        const rowH = PDF_ROW_H;
        // item.height includes the grade-start gap on a grade's first row (0 otherwise) — the
        // difference between the item's own height and the plain row height IS that gap.
        const gapAmount = item.height - rowH;
        // A hairline in the middle of that gap marks every grade/price-level change, so a reader
        // scanning a dense column can see at a glance where one grade's ranking ends and the
        // next begins — not just from the (subtler) blank-line spacing alone.
        if (item.gradeStart && prevKind === "row") {
          doc.setDrawColor(...PDF_GRADE_RULE);
          doc.setLineWidth(0.35);
          doc.line(x, cy + gapAmount / 2, x + w, cy + gapAmount / 2);
        }
        cy += gapAmount;
        doc.setFillColor(...(r.isOurs ? PDF_OURS_FILL : PDF_PAPER));
        doc.rect(x, cy, w, rowH, "F");
        const color = r.isOurs ? PDF_UP : PDF_INK;
        doc.setTextColor(...color);
        doc.setFont("helvetica", r.isOurs ? "bold" : "normal");
        doc.setFontSize(8);
        doc.text(fitText(doc, r.sellingMark, markW - 2), x + 3, cy + rowH - 1.3);
        // Grade code: bold and sized close to the mark/price text — this is the field a reader is
        // actually scanning the column for, so it needs to read as clearly as the price does, not
        // recede as a small monospace afterthought.
        doc.setFont("courier", "bold");
        doc.setFontSize(8.6);
        doc.setTextColor(...color);
        doc.text(fitText(doc, r.grade, gradeW - 3), x + 3 + markW, cy + rowH - 1.3);
        if (r.isOurs) {
          doc.setTextColor(...PDF_UP);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(8);
          doc.text("@", x + 3 + markW + gradeW + atW / 2, cy + rowH - 1.3, { align: "center" });
        }
        doc.setFont("courier", "bold");
        doc.setFontSize(8.3);
        doc.setTextColor(...color);
        doc.text(r.price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), x + w - 3, cy + rowH - 1.3, { align: "right" });
        cy += rowH;
        break;
      }
    }
    prevKind = item.kind;
  });
}

// Cap on how much extra breathing room a single region break can absorb — splitFlowColumns
// already keeps each column's own leftover slack small (a handful of rows' worth at most), so
// this only guards the rare edge case of a column with very few region breaks to spread real
// slack across.
const PDF_MAX_EXTRA_GAP = 14;

/** One region-cards page: every column drawn from its own slice of the flowing item list (see
 *  splitFlowColumns/groupColumnsIntoPages for how those slices — and which page each lands on —
 *  are decided). Whatever small amount of slack is left in a given column (it was already close
 *  to full before this) is distributed as extra breathing room between that column's own
 *  regions, so even that residual reads as deliberate spacing rather than the column trailing
 *  off unevenly. Column width comes from THIS page's own `columns.length` — every page except
 *  possibly the last has the same count (evenPageSizes keeps them even), so widths still line up
 *  page to page; a genuinely shorter last page gets fewer, proportionally wider columns instead
 *  of the same narrow slots with empty space stranded on the right. */
function drawFlowPage(doc: jsPDF, columns: FlowItem[][], meta: TppMeta, pageIndex: number, totalPages: number): void {
  doc.addPage([PDF_PAGE_W, PDF_PAGE_H], "landscape");
  doc.setFillColor(...PDF_PAPER);
  doc.rect(0, 0, PDF_PAGE_W, PDF_PAGE_H, "F");
  drawMasthead(doc, meta, "Top Price Page", `Page ${pageIndex + 1} of ${totalPages}`);
  drawFooter(doc, meta);

  const bodyTop = PDF_MARGIN + PDF_MASTHEAD_H + PDF_GAP_V;
  const bodyBottom = PDF_PAGE_H - PDF_MARGIN - PDF_FOOTER_H - PDF_GAP_V;
  const bodyHeight = bodyBottom - bodyTop;
  const cols = columns.length;
  const colW = (PDF_BODY_W - (cols - 1) * PDF_COL_GAP) / cols;

  columns.forEach((colItems, i) => {
    const x = PDF_MARGIN + i * (colW + PDF_COL_GAP);
    const naturalHeight = colItems.reduce((s, it) => s + it.height, 0);
    const regionBreaks = colItems.filter((it) => it.kind === "region").length - 1;
    const slack = Math.max(0, bodyHeight - naturalHeight);
    const extraGap = regionBreaks > 0 ? Math.min(PDF_MAX_EXTRA_GAP, slack / regionBreaks) : 0;
    drawFlowColumn(doc, colItems, x, bodyTop, colW, extraGap);
  });
}

interface PdfRefTable extends RefTable {
  title: string;
}

const PDF_RULE_FAINT: [number, number, number] = [226, 224, 216];
const PDF_ZEBRA: [number, number, number] = [248, 247, 244];

/** One reference panel drawn as a bordered ledger card of FIXED height `h` (a band boundary
 *  shared by every panel in its row, not the table's own natural content height) — a table with
 *  few rows (Selling Brokers, Currencies) doesn't leave the rest of that height blank; it's
 *  filled with faint ruled lines down to the card's own bottom edge, the same way a paper ledger
 *  leaves ruled space for entries not yet written in. That's what keeps this page fully "inked"
 *  edge-to-edge for any sale, since these tables' real row counts are placeholders today (no
 *  editor exists yet to fill them) and will vary once one does. */
function drawPanelCard(doc: jsPDF, x: number, y: number, w: number, h: number, table: PdfRefTable): void {
  const HEAD_H = 7,
    COL_H = 5.5,
    ROW_H = 6.2;

  doc.setDrawColor(...PDF_RULE_FAINT);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  doc.setFillColor(...PDF_INK);
  doc.rect(x, y, w, HEAD_H, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(table.title, x + 3, y + HEAD_H / 2 + 1.3);
  let cy = y + HEAD_H;

  const nCols = table.headers.length;
  const labelW = w * 0.34;
  const valW = (w - labelW) / Math.max(1, nCols - 1);
  doc.setFillColor(...PDF_HEAD_FILL);
  doc.rect(x, cy, w, COL_H, "F");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(6.8);
  doc.setTextColor(...PDF_FAINT);
  table.headers.forEach((hd, ci) => {
    const cx = ci === 0 ? x + 3 : x + labelW + (ci - 1) * valW + valW - 3;
    doc.text(hd.toUpperCase(), cx, cy + COL_H / 2 + 1, { align: ci === 0 ? "left" : "right" });
  });
  cy += COL_H;

  table.rows.forEach((r, ri) => {
    const isTotal = table.totalRow && ri === table.rows.length - 1;
    if (isTotal) {
      doc.setDrawColor(...PDF_INK);
      doc.setLineWidth(0.3);
      doc.line(x + 2, cy, x + w - 2, cy);
    } else if (ri % 2 === 1) {
      doc.setFillColor(...PDF_ZEBRA);
      doc.rect(x, cy, w, ROW_H, "F");
    }
    doc.setFont("helvetica", isTotal ? "bold" : "normal");
    doc.setFontSize(7.6);
    doc.setTextColor(...PDF_INK);
    r.forEach((val, ci) => {
      const text = fitText(doc, String(val ?? ""), (ci === 0 ? labelW : valW) - 5);
      if (ci === 0) doc.text(text, x + 3, cy + ROW_H / 2 + 1.3);
      else doc.text(text, x + labelW + (ci - 1) * valW + valW - 3, cy + ROW_H / 2 + 1.3, { align: "right" });
    });
    cy += ROW_H;
  });

  doc.setDrawColor(...PDF_RULE_FAINT);
  doc.setLineWidth(0.2);
  while (cy + ROW_H <= y + h - 3) {
    cy += ROW_H;
    doc.line(x + 3, cy, x + w - 3, cy);
  }
}

/** The Crop & Weather card — same bordered-card footprint as drawPanelCard, but its content is
 *  free text rather than a row table: each note's block gets an equal share of the card height,
 *  with the same faint ruled lines filling whatever it doesn't use for its own seed text. */
function drawCropCard(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  const HEAD_H = 7;
  doc.setDrawColor(...PDF_RULE_FAINT);
  doc.setLineWidth(0.3);
  doc.rect(x, y, w, h);

  doc.setFillColor(...PDF_INK);
  doc.rect(x, y, w, HEAD_H, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Crop & Weather", x + 3, y + HEAD_H / 2 + 1.3);

  let cy = y + HEAD_H + 3;
  const itemH = (y + h - cy) / CROP_NOTES.length;
  CROP_NOTES.forEach(([label, seed]) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.8);
    doc.setTextColor(...PDF_FAINT);
    doc.text(label.toUpperCase(), x + 3, cy + 3);
    doc.setFont("helvetica", "italic");
    doc.setFontSize(7.6);
    doc.setTextColor(...PDF_INK);
    doc.text(fitText(doc, seed, w - 6), x + 3, cy + 8.5);
    doc.setDrawColor(...PDF_RULE_FAINT);
    doc.setLineWidth(0.2);
    for (let ly = cy + 13; ly <= cy + itemH - 3; ly += 6) doc.line(x + 3, ly, x + w - 3, ly);
    cy += itemH;
  });
}

/** The final sheet — Order of Sale, Selling Brokers, Currencies, Sale Averages, Weekly Averages
 *  and Crop & Weather, the same 3-up arrangement (and the same blank placeholder data) as the
 *  Excel Reference Data sheet, laid out as a 2-band x 3-column ledger grid: every panel in a band
 *  shares that band's exact height (computed once from the page's own real body height, so it
 *  scales to any page geometry), which is what keeps this page fully filled top-to-bottom instead
 *  of the panels' own short placeholder row counts trailing off into open white space. */
function drawReferencePage(doc: jsPDF, meta: TppMeta, totalPages: number): void {
  doc.addPage([PDF_PAGE_W, PDF_PAGE_H], "landscape");
  doc.setFillColor(...PDF_PAPER);
  doc.rect(0, 0, PDF_PAGE_W, PDF_PAGE_H, "F");
  drawMasthead(doc, meta, "Top Price Page — Reference Data", `Page ${totalPages} of ${totalPages}`);
  drawFooter(doc, meta);

  const bodyTop = PDF_MARGIN + PDF_MASTHEAD_H + PDF_GAP_V;
  const bodyBottom = PDF_PAGE_H - PDF_MARGIN - PDF_FOOTER_H - PDF_GAP_V;
  const groupW = (PDF_BODY_W - 2 * PDF_COL_GAP) / 3;
  const bandH = (bodyBottom - bodyTop - PDF_GAP_V) / 2;
  const row1Y = bodyTop;
  const row2Y = row1Y + bandH + PDF_GAP_V;

  const t = referenceTables();
  drawPanelCard(doc, PDF_MARGIN, row1Y, groupW, bandH, { title: "Order of Sale — Offers", ...t.orderOfSale });
  drawPanelCard(doc, PDF_MARGIN + groupW + PDF_COL_GAP, row1Y, groupW, bandH, { title: "Selling Brokers", ...t.sellingBrokers });
  drawPanelCard(doc, PDF_MARGIN + (groupW + PDF_COL_GAP) * 2, row1Y, groupW, bandH, { title: "Currencies", ...t.currencies });

  drawPanelCard(doc, PDF_MARGIN, row2Y, groupW, bandH, { title: "Sale Averages", ...t.saleAverages });
  drawPanelCard(doc, PDF_MARGIN + groupW + PDF_COL_GAP, row2Y, groupW, bandH, { title: "Weekly Averages", ...t.weeklyAverages });
  drawCropCard(doc, PDF_MARGIN + (groupW + PDF_COL_GAP) * 2, row2Y, groupW, bandH);
}

// Fixed column count for every region-cards page — matches the Excel exporter's own
// TPP_REGION_COLUMNS, so both formats read the same way. Nothing shrinks to force a fit anymore:
// a light sale's pages just have more empty vertical room to breathe (soaked up as extra spacing
// between regions — see drawFlowPage); a heavy sale simply spills onto as many extra pages as it
// genuinely needs, at the same fixed, always-legible size throughout.
const PDF_FLOW_COLUMNS = TPP_REGION_COLUMNS;

/** Decides how many columns to divide the content across, and how those columns group into
 *  pages, so every column ends up close to the same height AND every page ends up with close to
 *  the same number of columns — instead of the greedy overflow of stuffing full pages one after
 *  another and stranding whatever's left on an almost-empty trailing page.
 *
 *  Every column break ALSO inserts a "(cont'd)" region/block header — real height
 *  splitFlowColumns has to draw that isn't in the raw item list's own height sum — so naively
 *  dividing the raw total by a column count and re-deriving a NEW column count from that is
 *  unstable: shrinking the per-column target causes MORE breaks, which adds MORE header
 *  overhead, which by itself demands an even smaller target next time, with no natural floor to
 *  stop at. The number of columns a given target needs is, however, monotonic — a bigger target
 *  can only ever delay a break, never force an extra one — so instead: fill each column right up
 *  to the real page capacity (`maxColHeight`, which can never overflow by construction) to learn
 *  the bare minimum column count (`rawColumns`) the content needs at all, then binary-search the
 *  smallest per-column target that still fits within that same column count. Finally, spread
 *  `rawColumns` across however many pages that implies as evenly as possible (evenPageSizes) —
 *  not sequential fixed-width chunks — so the LAST page is never left holding an orphaned
 *  fraction of a full page's width. */
function planFlowColumns(items: FlowItem[], maxColsPerPage: number, maxColHeight: number): FlowItem[][][] {
  const rawColumns = splitFlowColumns(items, maxColHeight).length;

  let lo = maxColHeight / rawColumns;
  let hi = maxColHeight;
  for (let i = 0; i < 25; i++) {
    const mid = (lo + hi) / 2;
    if (splitFlowColumns(items, mid).length <= rawColumns) hi = mid;
    else lo = mid;
  }
  const columns = splitFlowColumns(items, hi);

  const numPages = Math.max(1, Math.ceil(columns.length / maxColsPerPage));
  return groupColumnsIntoPages(columns, evenPageSizes(columns.length, numPages));
}

export async function exportTopPricePagePdf(combined: CombinedReport, referenceReport?: AuctionReport): Promise<void> {
  const meta = buildTppMeta(combined, referenceReport);

  const items = buildFlowItems(combined);
  const pages = planFlowColumns(items, PDF_FLOW_COLUMNS, PDF_BODY_H);
  const totalPages = pages.length + 1; // + the trailing Reference Data page

  // jsPDF always creates one initial page; the loop below adds its own pages via addPage(), so
  // the constructor's default first page is deleted once real content exists to replace it.
  const doc = new jsPDF({ unit: "mm", format: [PDF_PAGE_W, PDF_PAGE_H], orientation: "landscape" });

  pages.forEach((columns, i) => drawFlowPage(doc, columns, meta, i, totalPages));
  drawReferencePage(doc, meta, totalPages);
  doc.deletePage(1); // the blank default page from the constructor

  doc.save(`top-price-page-sale-${meta.auctionNumber || "draft"}-${dateStamp()}.pdf`);
}
