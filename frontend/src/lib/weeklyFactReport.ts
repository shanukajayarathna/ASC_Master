"use client";

/* =====================================================================
   WEEKLY FACT REPORTS — UVA/WESTERN HIGH & MEDIUM ranking workbooks
   ---------------------------------------------------------------------
   Line-for-line port of the original standalone app's weekly-report.js
   (itself a client-side port of a local Flask tool's core/txt_parser.py,
   core/wes_parser.py, core/xlsx_builder.py, core/pipeline.py). The
   parsing rules, column layout and Excel-building steps below are kept
   equivalent to that source — see each function's comment for the
   original module it mirrors. Comments explaining *why* a step is done
   a specific way (ExcelJS quirks discovered by diffing cell-for-cell
   against a Python/openpyxl reference) are preserved verbatim: they
   record hard-won fixes, not just what the code does.

   Given this week's two source files:
     1. CBAC{sale}.TXT  — the Colombo Brokers' Association elevation
        average report (plain text). Supplies the "Elevation Avr"
        benchmark (Sale / Month-to-date / Year-to-date net average) for
        each category, and the sale date/number.
     2. WES{sale}E.xlsx — the master factory-wise sale workbook, with
        all five category blocks stacked in one sheet. Supplies the
        per-estate rows.
   it rebuilds the four FACT ranking workbooks (UVA HIGH, UVA MEDIUM,
   WESTERN HIGH, WESTERN MEDIUM), starting from a verified real output
   file per category (fetched from /templates/fact/*.xlsx — extracted
   from the original's embedded tea-templates-data.js) so header
   formatting, the logo, column widths, fonts and borders are
   reproduced exactly — only the data region is replaced. The combined
   RANK workbook does the same from /templates/rank/*.xlsx.
   ===================================================================== */

import ExcelJS from "exceljs";

// ---- TXT PARSER — mirrors tea_report_app/core/txt_parser.py -------------------------------

const CATEGORY_ALIASES: Record<string, string> = {
  "UVA HIGH": "UVA HIGH",
  "UVA MEDIUM": "UVA MEDIUM",
  "WESTERN HIGH": "WESTERN HIGH",
  "WESTERN MEDIUM": "WESTERN MEDIUM",
  LOW: "LOW",
};

const SALE_LINE_RE = /S\s*A\s*L\s*E\s+O\s*F\s+(\d{2}\/\d{2}\/\d{2})\s+NO\.\s*(\d+)/;
const SUMMARY_RE = /^\s*SUMMARY OF (.+?)\s*$/;
const NUMBER_RE_G = /[\d,]+\.\d{2}/g;

export interface TxtCategory {
  category: string;
  sale_qty: number | null;
  sale_avg: number | null;
  mtd_qty: number | null;
  mtd_avg: number | null;
  ytd_qty: number | null;
  ytd_avg: number | null;
}

export interface TxtReport {
  saleNumber: number | null;
  saleDate: string | null;
  categories: Record<string, TxtCategory>;
  warnings: string[];
}

function findRulerSpans(lines: string[]): [number, number][] | null {
  for (const line of lines) {
    const dashCount = (line.match(/-/g) || []).length;
    if (dashCount >= 40 && /^[- ]*$/.test(line.trim())) {
      const spans: [number, number][] = [];
      const re = /-+/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(line)) !== null) spans.push([m.index, m.index + m[0].length]);
      if (spans.length === 9) return spans;
    }
  }
  return null;
}

/** Number token whose match ends at/near endCol, scanning a window ending at endCol (numbers
 *  are right-justified to this column). */
function numEndingAt(line: string, endCol: number, lookback = 25): number | null {
  if (endCol > line.length) endCol = line.length;
  const start = Math.max(0, endCol - lookback);
  const window = line.slice(start, endCol + 2);
  const matches = [...window.matchAll(/[\d,]+\.\d{2}/g)];
  if (!matches.length) return null;
  let best: RegExpMatchArray | null = null;
  for (const m of matches) {
    const absEnd = start + (m.index ?? 0) + m[0].length;
    if (absEnd <= endCol + 2) best = m;
  }
  const token = (best || matches[matches.length - 1])[0];
  return parseFloat(token.replace(/,/g, ""));
}

export function parseTxt(text: string): TxtReport {
  const lines = String(text || "").split(/\r\n|\r|\n/);
  const warnings: string[] = [];

  const rulerSpans = findRulerSpans(lines);
  let totSoldEnd: number | null = null;
  let totGrossEnd: number | null = null;
  if (rulerSpans === null) {
    warnings.push(
      "Could not locate the report's column ruler line; falling back to best-effort number extraction (verify results carefully)."
    );
  } else {
    totSoldEnd = rulerSpans[6][1];
    totGrossEnd = rulerSpans[7][1];
  }

  let saleNumber: number | null = null;
  let saleDate: string | null = null;
  const saleMatch = SALE_LINE_RE.exec(text);
  if (saleMatch) {
    const [yy, mm, dd] = saleMatch[1].split("/");
    saleDate = `${dd}/${mm}/20${yy}`;
    saleNumber = parseInt(saleMatch[2], 10);
  } else {
    warnings.push("Could not find a 'S A L E OF <date> NO. <sale>' line in the TXT.");
  }

  function extractTotal(line: string): [number | null, number | null] {
    if (totSoldEnd !== null && totGrossEnd !== null) {
      return [numEndingAt(line, totSoldEnd), numEndingAt(line, totGrossEnd)];
    }
    const nums = line.match(NUMBER_RE_G) || [];
    if (nums.length >= 2) {
      return [parseFloat(nums[nums.length - 2].replace(/,/g, "")), parseFloat(nums[nums.length - 1].replace(/,/g, ""))];
    }
    return [null, null];
  }

  const categories: Record<string, TxtCategory> = {};
  let i = 0;
  const n = lines.length;
  while (i < n) {
    const m = SUMMARY_RE.exec(lines[i]);
    if (!m) {
      i += 1;
      continue;
    }
    const rawName = m[1].trim();
    i += 1;
    const blockStart = i;
    while (i < n && !SUMMARY_RE.exec(lines[i])) i += 1;
    const block = lines.slice(blockStart, i);

    if (!rawName.endsWith("-OTHODOX")) continue;
    const elevation = rawName.slice(0, -"-OTHODOX".length).trim();
    const category = CATEGORY_ALIASES[elevation];
    if (category === undefined) {
      warnings.push(`Unrecognised elevation/grade category in TXT: '${elevation}' (skipped).`);
      continue;
    }

    let saleQty: number | null = null,
      saleAvg: number | null = null,
      mtdQty: number | null = null,
      mtdAvg: number | null = null,
      ytdQty: number | null = null,
      ytdAvg: number | null = null;
    for (const line of block) {
      const stripped = line.trim();
      if (stripped.startsWith("S A L E") || /^S\s*A\s*L\s*E\b/.test(stripped)) {
        [saleQty, saleAvg] = extractTotal(line);
      } else if (stripped.startsWith("1ST JANUARY")) {
        [ytdQty, ytdAvg] = extractTotal(line);
      } else if (stripped.startsWith("MONTH TO DATE")) {
        [mtdQty, mtdAvg] = extractTotal(line);
      }
    }

    if (categories[category]) {
      warnings.push(`Duplicate '${rawName}' section in TXT; using the last occurrence.`);
    }
    categories[category] = { category, sale_qty: saleQty, sale_avg: saleAvg, mtd_qty: mtdQty, mtd_avg: mtdAvg, ytd_qty: ytdQty, ytd_avg: ytdAvg };
  }

  for (const needed of ["UVA HIGH", "UVA MEDIUM", "WESTERN HIGH", "WESTERN MEDIUM"]) {
    const cat = categories[needed];
    if (!cat) {
      warnings.push(`'${needed}-OTHODOX' section not found in TXT.`);
    } else if (cat.sale_avg == null || cat.mtd_avg == null || cat.ytd_avg == null) {
      warnings.push(`'${needed}-OTHODOX' section is missing one or more benchmark values (sale=${cat.sale_avg}, mtd=${cat.mtd_avg}, ytd=${cat.ytd_avg}).`);
    }
  }

  return { saleNumber, saleDate, categories, warnings };
}

// ---- WES WORKBOOK PARSER — mirrors tea_report_app/core/wes_parser.py ----------------------

const CATEGORY_NAMES = ["UVA HIGH", "WESTERN HIGH", "UVA MEDIUM", "WESTERN MEDIUM", "LOW"];

// Raw cell values are carried through untouched, exactly like the original — the WES source
// occasionally has a whitespace-padded string in a "numeric" column instead of a true blank
// (verified against real WES files), and the original never coerces these to a number; it
// writes whatever it read straight into the FACT/RANK cells and lets Excel/the arithmetic below
// handle it the same way plain JS would (numeric string -> parsed, whitespace string -> 0 via
// ToNumber, anything else -> NaN). Coercing here would silently null out real source content.
export type RawValue = string | number | Date | null;

export interface WesRow {
  estate: string;
  code: string;
  week_qty: RawValue;
  week_avg: RawValue;
  month_qty: RawValue;
  month_avg: RawValue;
  year_qty: RawValue;
  year_avg: RawValue;
  week_rank: RawValue;
  month_rank: RawValue;
  year_rank: RawValue;
}

export interface WesReport {
  saleNumber: number | null;
  categories: Record<string, WesRow[]>;
  warnings: string[];
}

function isBlankCell(v: ExcelJS.CellValue): boolean {
  return v == null || (typeof v === "string" && v.trim() === "");
}

function rawCellValue(v: ExcelJS.CellValue): string | number | Date | null {
  if (v instanceof Date) return v;
  if (v && typeof v === "object") {
    if ("result" in v) return (v as { result: string | number | null }).result;
    if ("richText" in v) return (v as ExcelJS.CellRichTextValue).richText.map((t) => t.text).join("");
    if ("text" in v && (v as { text?: unknown }).text != null) return (v as { text: string }).text;
  }
  return v as string | number | null;
}

export async function parseWes(arrayBuffer: ArrayBuffer): Promise<WesReport> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(arrayBuffer);
  const ws = wb.worksheets[0];

  const warnings: string[] = [];
  let saleNumber: number | null = null;

  const maxRow = ws.rowCount;
  const nameRows: [number, string][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const a = ws.getCell(r, 1).value;
    if (typeof a === "string" && CATEGORY_NAMES.includes(a.trim())) {
      nameRows.push([r, a.trim()]);
      if (saleNumber === null) {
        const saleCell = ws.getCell(r - 2, 1).value;
        if (typeof saleCell === "string" && saleCell.includes("SALE NUMBER")) {
          const digits = saleCell.replace(/[^0-9]/g, "");
          if (digits) saleNumber = parseInt(digits, 10);
        }
      }
    }
  }

  const totalRows: number[] = [];
  for (let r = 1; r <= maxRow; r++) {
    const v = ws.getCell(r, 1).value;
    if (typeof v === "string" && v.includes("ELEVATION TOTAL")) totalRows.push(r);
  }

  const categories: Record<string, WesRow[]> = {};
  for (const [nameRow, cat] of nameRows) {
    const dataStart = nameRow + 3;
    const endCandidates = totalRows.filter((tr) => tr > nameRow);
    if (!endCandidates.length) {
      warnings.push(`Could not find 'ELEVATION TOTAL' marker after '${cat}' block; skipping.`);
      continue;
    }
    const dataEnd = endCandidates[0] - 1;

    const rows: WesRow[] = [];
    for (let r = dataStart; r <= dataEnd; r++) {
      const estateRaw = ws.getCell(r, 1).value;
      if (isBlankCell(estateRaw)) continue;
      const codeRaw = ws.getCell(r, 2).value;
      const vals: RawValue[] = [];
      for (let c = 3; c <= 11; c++) vals.push(rawCellValue(ws.getCell(r, c).value));
      rows.push({
        estate: String(estateRaw),
        code: codeRaw != null ? String(rawCellValue(codeRaw)) : "",
        week_qty: vals[0],
        week_avg: vals[1],
        month_qty: vals[2],
        month_avg: vals[3],
        year_qty: vals[4],
        year_avg: vals[5],
        week_rank: vals[6],
        month_rank: vals[7],
        year_rank: vals[8],
      });
    }

    if (categories[cat]) warnings.push(`Duplicate '${cat}' block found in WES file; using the last occurrence.`);
    categories[cat] = rows;
  }

  for (const needed of ["UVA HIGH", "UVA MEDIUM", "WESTERN HIGH", "WESTERN MEDIUM"]) {
    if (!(needed in categories)) warnings.push(`'${needed}' block not found in the WES file.`);
    else if (categories[needed].length === 0) warnings.push(`'${needed}' block found but has no estate rows.`);
  }

  return { saleNumber, categories, warnings };
}

// ---- TEMPLATE LOADING — fetches the real, verified workbooks extracted from the original's
// embedded base64 (tea-templates-data.js / rank-templates-data.js) instead of bundling ~450KB
// of base64 straight into the JS bundle -------------------------------------------------------

type TemplateKey = "UH" | "UM" | "WH" | "WM";

const templateCache = new Map<string, ArrayBuffer>();

async function loadTemplate(url: string): Promise<ArrayBuffer> {
  const cached = templateCache.get(url);
  if (cached) return cached.slice(0);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Could not load template ${url}`);
  const buf = await res.arrayBuffer();
  templateCache.set(url, buf);
  return buf.slice(0);
}

const factTemplateUrl = (key: TemplateKey) => `/templates/fact/fact-${key.toLowerCase()}.xlsx`;
const rankTemplateUrl = (key: TemplateKey) => `/templates/rank/rank-${key.toLowerCase()}.xlsx`;

// ---- XLSX BUILDER — mirrors tea_report_app/core/xlsx_builder.py ---------------------------
// Template layout (cols A..K, rows 1-8 = header, row 9.. = estate data, final row = "Elevation
// Avr"): A Estate, B MF/MSL code, C/D Week qty/avg, E/F Month qty/avg, G/H Year qty/avg, I/J/K
// Week/Month/Year rank. Only rows 9..N are ever touched.

const DATA_START_ROW = 9;
const DATA_COLS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

interface CapturedStyle {
  font: Partial<ExcelJS.Font> | undefined;
  border: Partial<ExcelJS.Borders> | undefined;
  alignment: Partial<ExcelJS.Alignment> | undefined;
  numFmt: string | undefined;
  fill?: ExcelJS.Fill | undefined;
}

function cloneStyle<T>(x: T): T {
  return x == null ? x : (JSON.parse(JSON.stringify(x)) as T);
}

function findElevationRow(ws: ExcelJS.Worksheet): number {
  const maxRow = ws.rowCount;
  for (let r = DATA_START_ROW; r <= maxRow; r++) {
    const v = ws.getCell(r, 1).value;
    if (typeof v === "string" && v.includes("Elevation")) return r;
  }
  throw new Error("Template is missing its 'Elevation Avr' row; template may be corrupted.");
}

/** Unmerges every merge range confined to a single row, so insert/delete of rows below never
 *  drags a stale merge along with it — openpyxl/ExcelJS both fail to relocate merges reliably
 *  across a row splice, so the elevation row's merges are dropped here and re-created at their
 *  new position once the row count is settled. */
function unmergeRowMerges(ws: ExcelJS.Worksheet, row: number, maxCol = 20): void {
  let c = 1;
  while (c <= maxCol) {
    const cell = ws.getCell(row, c);
    // ExcelJS's own types declare Cell.row/col as string (a long-standing typings gap — the
    // runtime values are the numbers this code needs), hence the Number() casts below.
    if (cell.isMerged && cell.master && Number(cell.master.row) === row) {
      const masterCol = Number(cell.master.col);
      let endCol = masterCol;
      let cc = masterCol;
      while (cc <= maxCol) {
        const probe = ws.getCell(row, cc);
        if (probe.isMerged && probe.master && Number(probe.master.row) === row && Number(probe.master.col) === masterCol) {
          endCol = cc;
          cc += 1;
        } else break;
      }
      ws.unMergeCells(row, masterCol, row, endCol);
      c = endCol + 1;
    } else {
      c += 1;
    }
  }
}

function sortEstateRows(rows: WesRow[]): WesRow[] {
  return rows.slice().sort((a, b) => {
    const ra = typeof a.year_rank === "number" && isFinite(a.year_rank) ? a.year_rank : Infinity;
    const rb = typeof b.year_rank === "number" && isFinite(b.year_rank) ? b.year_rank : Infinity;
    if (ra !== rb) return ra - rb;
    if (a.estate < b.estate) return -1;
    if (a.estate > b.estate) return 1;
    return 0;
  });
}

/** Wipes cell values and merges across a row band. Used instead of a true row insert/delete:
 *  ExcelJS's spliceRows() was found (by diffing its output cell-for-cell against openpyxl's on
 *  these exact templates) to leave stale rows behind on a large delete, because these templates'
 *  declared sheet dimension runs well past their actual last row of content. Since the template
 *  has nothing below its own Elevation Avr row, clearing straight through to the new elevation
 *  row and rewriting everything in that band from scratch reaches the same end state as
 *  openpyxl's insert_rows/delete_rows without depending on that shift. */
function clearRowBand(ws: ExcelJS.Worksheet, rowFrom: number, rowTo: number, colTo: number): void {
  for (let r = rowFrom; r <= rowTo; r++) {
    unmergeRowMerges(ws, r, colTo);
    for (let c = 1; c <= colTo; c++) ws.getCell(r, c).value = null;
  }
}

// How many rows below the template's own Elevation Avr row to capture the (mostly-blank, but
// not entirely default) style of, so a category with far more estates than its template
// originally had can still land on an exact style match that far past the template's original
// extent.
const TAIL_STYLE_CAPTURE_ROWS = 300;

export interface CategoryWorkbookResult {
  buffer: ArrayBuffer;
  rowCount: number;
  warnings: string[];
}

async function buildCategoryWorkbook(opts: {
  templateKey: TemplateKey;
  estateRows: WesRow[];
  benchmark: [number | null, number | null, number | null];
  saleDate: string | null;
  saleNumber: number | null;
}): Promise<CategoryWorkbookResult> {
  const { templateKey, estateRows, benchmark, saleDate, saleNumber } = opts;
  const warnings: string[] = [];
  const [saleAvg, mtdAvg, ytdAvg] = benchmark;

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(await loadTemplate(factTemplateUrl(templateKey)));
  const ws = wb.worksheets[0];
  const origRowCount = ws.rowCount;

  const elevRowOld = findElevationRow(ws);

  // Capture the uniform data-row style from row 9, and the Elevation Avr row's own distinct
  // style (bold, its own border pattern), before anything below row 9 is touched. openpyxl's
  // insert_rows/delete_rows carries the elevation row's formatting with it as a physical row
  // move; since this port clears and rewrites instead of shifting, that style has to be
  // captured and reapplied explicitly to land the same.
  const captureStyle = (row: number): CapturedStyle[] =>
    DATA_COLS.map((c) => {
      const src = ws.getCell(row, c);
      return { font: cloneStyle(src.font), border: cloneStyle(src.border), alignment: cloneStyle(src.alignment), numFmt: src.numFmt, fill: cloneStyle(src.fill) };
    });
  const styleSource = captureStyle(DATA_START_ROW);
  const elevStyleSource = captureStyle(elevRowOld);
  // The rows below the template's own Elevation Avr row aren't styled fully blank — several
  // carry a lingering per-column number format (e.g. "#,##0.00" on the qty/avg columns) even
  // with no border, no fill and no value. openpyxl's delete_rows/insert_rows physically shifts
  // row (elevRowOld + k) to (elevRowNew + k) for every k, so whatever a row past the template's
  // elevation row is styled like lands at the same offset past the NEW elevation row; captured
  // here, before anything is touched, to reproduce that shift exactly.
  const tailStyleSource: CapturedStyle[][] = [];
  for (let k = 1; k <= TAIL_STYLE_CAPTURE_ROWS; k++) tailStyleSource.push(captureStyle(elevRowOld + k));

  const rowsSorted = sortEstateRows(estateRows);
  const countNew = rowsSorted.length;

  if (countNew === 0) warnings.push("No estate rows were provided for this category; sheet body left empty.");

  const elevRowNew = DATA_START_ROW + countNew;
  // The template's declared row count typically runs a good deal past its own Elevation Avr row
  // (blank rows carrying only a stray number format, no border/fill/value) — openpyxl's
  // delete_rows/insert_rows shifts that whole tail along with everything else, landing it at
  // elevRowNew+k for every k it used to sit at elevRowOld+k. Matching that means reaching through
  // to where the template's own last row ends up after the same shift (which, on a large insert,
  // lands well past the template's original row count).
  const tailReach = elevRowNew + Math.max(0, origRowCount - elevRowOld);
  const clearThrough = Math.max(elevRowOld, elevRowNew, origRowCount, tailReach);
  clearRowBand(ws, DATA_START_ROW, clearThrough, 20);

  // Re-apply a uniform data-row style (font/border/alignment/number format/fill) to every data
  // row, cloned from the template's original row 9, so rows beyond the template's original count
  // (which come out unstyled) match. Assigning the whole `.style` object in one go (rather than
  // its font/border/etc. sub-properties one at a time) matters here: ExcelJS pools identical
  // style objects by reference across cells, and per-property assignment mutates that shared
  // object in place — corrupting every other cell still pointing at it (verified by diffing
  // against openpyxl's output, where a stray per-property assignment silently dropped borders on
  // unrelated rows).
  for (let r = DATA_START_ROW; r < elevRowNew; r++) {
    DATA_COLS.forEach((c, idx) => {
      ws.getCell(r, c).style = cloneStyle(styleSource[idx]) as ExcelJS.Style;
    });
  }

  // Rows past the new elevation row: reproduce the template's own (mostly-but-not-entirely-blank)
  // tail styling at the matching offset, falling back to a plain blank style past what was
  // captured.
  for (let r = elevRowNew + 1; r <= clearThrough; r++) {
    const tail = tailStyleSource[r - elevRowNew - 1];
    DATA_COLS.forEach((c, idx) => {
      ws.getCell(r, c).style = (tail ? cloneStyle(tail[idx]) : {}) as ExcelJS.Style;
    });
  }

  rowsSorted.forEach((row, offset) => {
    const r = DATA_START_ROW + offset;
    ws.getCell(r, 1).value = row.estate;
    ws.getCell(r, 2).value = row.code;
    ws.getCell(r, 3).value = row.week_qty;
    ws.getCell(r, 4).value = row.week_avg;
    ws.getCell(r, 5).value = row.month_qty;
    ws.getCell(r, 6).value = row.month_avg;
    ws.getCell(r, 7).value = row.year_qty;
    ws.getCell(r, 8).value = row.year_avg;
    ws.getCell(r, 9).value = row.week_rank;
    ws.getCell(r, 10).value = row.month_rank;
    ws.getCell(r, 11).value = row.year_rank;
  });

  // Elevation Avr row: re-merge A:B / C:D FIRST — ExcelJS's mergeCells() overwrites the
  // non-master cell's style to mirror the master's, so merging before the per-cell style/value
  // writes below (rather than after) is required for col B/D to keep their own border (verified
  // against openpyxl's read of the same file: merging afterward silently erased the merged box's
  // right edge).
  ws.mergeCells(elevRowNew, 1, elevRowNew, 2);
  ws.mergeCells(elevRowNew, 3, elevRowNew, 4);
  DATA_COLS.forEach((c, idx) => {
    ws.getCell(elevRowNew, c).style = cloneStyle(elevStyleSource[idx]) as ExcelJS.Style;
  });
  ws.getCell(elevRowNew, 1).value = "Elevation Avr";
  // Columns 2 and 4 are merge slaves of A:B / C:D: ExcelJS links a merged range's value to its
  // master cell, so writing null to the slave (as openpyxl's equivalent loop harmlessly does,
  // since it has no such linkage) would blank out the master's "Elevation Avr" label / C's
  // benchmark value here instead. Left untouched, matching them visually.
  for (let c = 5; c <= 11; c++) {
    if (c !== 6 && c !== 8) ws.getCell(elevRowNew, c).value = null;
  }
  ws.getCell(elevRowNew, 3).value = saleAvg;
  ws.getCell(elevRowNew, 6).value = mtdAvg;
  ws.getCell(elevRowNew, 8).value = ytdAvg;

  if (saleAvg == null || mtdAvg == null || ytdAvg == null) {
    warnings.push("One or more benchmark (Elevation Avr) values are missing for this category — check the TXT file has the matching -OTHODOX section.");
  }

  ws.pageSetup = ws.pageSetup || {};
  ws.pageSetup.printArea = `A1:K${elevRowNew}`;

  if (saleDate && saleNumber != null) {
    ws.getCell(5, 2).value = `${saleDate} - Sale ${saleNumber}`;
  } else {
    warnings.push("Sale date/number could not be determined; header line (B5) left unchanged from template.");
  }

  const buffer = await wb.xlsx.writeBuffer();
  return { buffer: buffer as ArrayBuffer, rowCount: countNew, warnings };
}

// ---- RANK WORKBOOK BUILDER — the combined "RANK FAC{sale}{year}.xlsx" workbook: one tab per
// category (only estates holding a month-todate rank, sorted by that rank, with a DEF +/- vs
// the month-todate benchmark) plus a Sheet1 that is a straight copy of the WES master sheet.
// Column layout per category tab (rows 1-17 = header, row 18.. = data): B Estate, C MF code,
// D Week qty, E Week avg, F Week rank, G Month-todate qty, H Month-todate avg, I DEF +/- (H
// minus the month-todate benchmark), J Rank (month-todate rank).

const RANK_CATEGORY_SPEC: Record<string, { templateKey: TemplateKey; tabName: string }> = {
  "UVA HIGH": { templateKey: "UH", tabName: "UH  FAC-21" },
  "UVA MEDIUM": { templateKey: "UM", tabName: "UM  FAC-21" },
  "WESTERN HIGH": { templateKey: "WH", tabName: "WH FAC-21" },
  "WESTERN MEDIUM": { templateKey: "WM", tabName: "WM FAC-21" },
};
// Tab order matches the manually-built workbooks this was reverse engineered from (WM, Sheet1,
// WH, UM, UH — no significance beyond matching what the team is already used to seeing).
const RANK_TAB_ORDER = ["WESTERN MEDIUM", "SHEET1", "WESTERN HIGH", "UVA MEDIUM", "UVA HIGH"];

const RANK_DATA_START_ROW = 18;
const RANK_DATA_COLS = [2, 3, 4, 5, 6, 7, 8, 9, 10]; // B..J
// Colors read directly off a real manually-built RANK workbook (Excel COM Interior.Color /
// Font.Color, converted from BGR to RGB): rows where the estate's month-todate avg beats the
// benchmark get a light fill with black text, rows below it get a plain white fill with red
// text — matching that workbook's own "Above the Average" / "Below the average" legend.
const RANK_ABOVE_FILL = "FFAEAAAA";
const RANK_ABOVE_FONT = "FF000000";
const RANK_BELOW_FILL = "FFFFFFFF";
const RANK_BELOW_FONT = "FFFF0000";

/** Filtered/sorted by MONTH rank, not week rank: an estate with no sale THIS week (week_qty/
 *  week_avg/week_rank all blank) still belongs on the sheet if it already holds a month-todate
 *  rank from an earlier sale this month — verified against real RANK workbooks, where such a
 *  row appears with its week columns blank but a real month rank and DEF +/-. Filtering on
 *  week_rank instead silently drops exactly these rows. */
function rankSortRows(rows: WesRow[]): WesRow[] {
  return rows
    .filter((r): r is WesRow & { month_rank: number } => typeof r.month_rank === "number" && isFinite(r.month_rank))
    .slice()
    .sort((a, b) => a.month_rank! - b.month_rank!);
}

async function buildRankCategorySheet(
  targetWb: ExcelJS.Workbook,
  category: string,
  spec: { templateKey: TemplateKey; tabName: string },
  estateRows: WesRow[],
  benchmark: [number | null, number | null],
  rankHeaderText: string
): Promise<{ rowCount: number; warnings: string[] }> {
  const warnings: string[] = [];
  const tmpWb = new ExcelJS.Workbook();
  await tmpWb.xlsx.load(await loadTemplate(rankTemplateUrl(spec.templateKey)));
  const srcWs = tmpWb.worksheets[0];

  const ws = targetWb.addWorksheet(spec.tabName);
  // Cross-workbook worksheet copy: ExcelJS has no first-class "import a worksheet from another
  // workbook" API, but a worksheet's `.model` is a plain serializable object (rows, cols,
  // merges, styles) — reassigning it onto a freshly-added sheet (with that sheet's own id/name
  // kept) reproduces the template's formatting exactly, same idea as the captureStyle()-based
  // cloning buildCategoryWorkbook() does above. Media (the letterhead logo) is excluded here and
  // re-added below — a worksheet's media anchors reference image ids on ITS OWN workbook
  // (tmpWb), which don't exist on targetWb, so copying them across as-is leaves a dangling image
  // reference that throws when the file is written.
  const srcMedia = srcWs.model.media || [];
  // Object.assign (not an object literal) sidesteps TS's excess-property check for `state` —
  // ExcelJS's own WorksheetModel type omits it, but the runtime model object carries it.
  //
  // mergeCells: the `.model` getter and setter disagree on the field name for merged ranges —
  // `get model()` emits `merges`, but `set model()`'s `_parseMergeCells` reads `mergeCells` (see
  // ExcelJS's own worksheet.js). Passed straight through, srcWs.model.merges is silently ignored
  // by the setter (`_.each(undefined, …)` is a no-op) and every merged range from the template —
  // the header banner's merged label boxes as well as any merged box inside the ranking table —
  // is dropped. The visible symptom is exactly what it looks like: text sized for a wide merged
  // cell overflowing across the now-separate cells next to it (the header looking "overlapped"),
  // and internal borders that a merge used to hide reappearing as gaps because the individual
  // cells on either side were never separately bordered (borders "missing" inside the table).
  ws.model = Object.assign({}, srcWs.model, {
    id: ws.id,
    name: spec.tabName,
    state: "visible",
    media: [],
    mergeCells: srcWs.model.merges,
  });
  srcMedia.forEach((medium) => {
    if (medium.type !== "image") return;
    // ExcelJS's Media type omits imageId/range for image media entries — undocumented in the
    // public .d.ts but present on the runtime object (verified against the original's own use
    // of these exact fields).
    const imageMedium = medium as unknown as { imageId: number; range: unknown };
    const img = tmpWb.getImage(imageMedium.imageId);
    const newImageId = targetWb.addImage(img);
    ws.addImage(newImageId, imageMedium.range as ExcelJS.ImageRange);
  });

  const [saleAvg, mtdAvg] = benchmark;
  // Unlike the FACT category workbooks' B5 header (which the ported source code overwrites with
  // "{date} - Sale {N}"), the real RANK archives show a hand-typed date-RANGE header that
  // doesn't match that format at all — see computeDefaultRankHeaderText's comment. rankHeaderText
  // is that computed default (or the user's own edit of it), left as the template's own value
  // only when genuinely empty.
  if (rankHeaderText) ws.getCell(4, 3).value = rankHeaderText;
  ws.getCell(10, 10).value = saleAvg;
  ws.getCell(11, 10).value = mtdAvg;
  if (saleAvg == null || mtdAvg == null) {
    warnings.push(`'${category}-OTHODOX' benchmark missing from TXT — benchmark cells left blank.`);
  }

  const captureStyle = (row: number): CapturedStyle[] =>
    RANK_DATA_COLS.map((c) => {
      const src = ws.getCell(row, c);
      return { font: cloneStyle(src.font), border: cloneStyle(src.border), alignment: cloneStyle(src.alignment), numFmt: src.numFmt };
    });
  const styleSource = captureStyle(RANK_DATA_START_ROW);

  const rowsSorted = rankSortRows(estateRows);
  if (rowsSorted.length === 0) warnings.push(`No estates with a month-todate rank found for '${category}'; sheet body left empty.`);

  rowsSorted.forEach((row, offset) => {
    const r = RANK_DATA_START_ROW + offset;
    // Number(...) reproduces plain JS's implicit ToNumber coercion that `row.month_avg - mtdAvg`
    // would apply anyway (a numeric string parses, a whitespace string becomes 0, anything else
    // becomes NaN) — needed only so TypeScript accepts subtracting a RawValue; the arithmetic
    // itself is unchanged from the original.
    const defVal = row.month_avg != null && mtdAvg != null ? Number(row.month_avg) - mtdAvg : null;
    const cells: RawValue[] = [row.estate, row.code, row.week_qty, row.week_avg, row.week_rank, row.month_qty, row.month_avg, defVal, row.month_rank];
    RANK_DATA_COLS.forEach((c, idx) => {
      const cell = ws.getCell(r, c);
      cell.value = cells[idx];
      cell.style = cloneStyle(styleSource[idx]) as ExcelJS.Style;
    });
    const above = defVal != null ? defVal >= 0 : true;
    const fillColor = above ? RANK_ABOVE_FILL : RANK_BELOW_FILL;
    const fontColor = above ? RANK_ABOVE_FONT : RANK_BELOW_FONT;
    RANK_DATA_COLS.forEach((c) => {
      const cell = ws.getCell(r, c);
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fillColor } };
      cell.font = { ...cloneStyle(cell.font), color: { argb: fontColor } };
    });
  });

  ws.pageSetup = ws.pageSetup || {};
  ws.pageSetup.printArea = `A1:J${RANK_DATA_START_ROW + rowsSorted.length}`;

  return { rowCount: rowsSorted.length, warnings };
}

/** Sheet1 is a straight copy (values + column widths only — this tab is a working reference,
 *  not a client-facing report) of the WES master sheet the four category tabs above are built
 *  from, matching the manually-built workbooks this was reverse engineered from. */
async function buildRankSheet1(targetWb: ExcelJS.Workbook, wesArrayBuffer: ArrayBuffer): Promise<void> {
  const srcWb = new ExcelJS.Workbook();
  await srcWb.xlsx.load(wesArrayBuffer);
  const srcWs = srcWb.worksheets[0];

  const ws = targetWb.addWorksheet("Sheet1");
  srcWs.columns.forEach((col, idx) => {
    if (col && col.width) ws.getColumn(idx + 1).width = col.width;
  });
  for (let r = 1; r <= srcWs.rowCount; r++) {
    for (let c = 1; c <= srcWs.columnCount; c++) {
      const v = rawCellValue(srcWs.getCell(r, c).value);
      if (v != null) ws.getCell(r, c).value = v;
    }
  }
}

export interface RankWorkbookResult {
  filename: string;
  buffer: ArrayBuffer;
  warnings: string[];
}

async function buildRankWorkbook(opts: {
  txtReport: TxtReport;
  wesReport: WesReport;
  wesArrayBuffer: ArrayBuffer;
  rankHeaderText: string;
  saleLabel: string;
  year: string;
}): Promise<RankWorkbookResult> {
  const { txtReport, wesReport, wesArrayBuffer, rankHeaderText, saleLabel, year } = opts;
  const warnings: string[] = [];
  const wb = new ExcelJS.Workbook();

  for (const tab of RANK_TAB_ORDER) {
    if (tab === "SHEET1") {
      await buildRankSheet1(wb, wesArrayBuffer);
      continue;
    }
    const spec = RANK_CATEGORY_SPEC[tab];
    const estateRows = wesReport.categories[tab] || [];
    const bench = txtReport.categories[tab];
    const benchmark: [number | null, number | null] = bench ? [bench.sale_avg, bench.mtd_avg] : [null, null];
    if (!bench) warnings.push(`'${tab}-OTHODOX' not found in TXT — '${spec.tabName}' benchmark cells left blank.`);
    if (!(tab in wesReport.categories)) warnings.push(`'${tab}' not found in the WES file — '${spec.tabName}' left empty.`);

    const result = await buildRankCategorySheet(wb, tab, spec, estateRows, benchmark, rankHeaderText);
    warnings.push(...result.warnings);
  }

  const filename = `RANK FAC${saleLabel}${year}.xlsx`;
  const buffer = await wb.xlsx.writeBuffer();
  return { filename, buffer: buffer as ArrayBuffer, warnings };
}

// ---- PIPELINE — mirrors tea_report_app/core/pipeline.py -----------------------------------

const CATEGORY_SPEC: Record<string, { templateKey: TemplateKey; suffix: string }> = {
  "UVA HIGH": { templateKey: "UH", suffix: "UHxlsx" },
  "UVA MEDIUM": { templateKey: "UM", suffix: "UMxlsx" },
  "WESTERN HIGH": { templateKey: "WH", suffix: "wh" },
  "WESTERN MEDIUM": { templateKey: "WM", suffix: "wM" },
};

export interface CategoryOutcome {
  category: string;
  filename: string;
  buffer: ArrayBuffer | null;
  rowCount: number;
  benchmark: [number | null, number | null, number | null];
  warnings: string[];
  ok: boolean;
}

export interface WeeklyJobResult {
  saleNumber: number | null;
  saleDate: string | null;
  outcomes: CategoryOutcome[];
  rankWorkbook: { filename: string | null; buffer: ArrayBuffer | null; ok: boolean } | null;
  rankWarnings: string[];
  warnings: string[];
}

export interface SaleOverrides {
  saleDate?: string;
  saleNumber?: number | "";
  /** RANK workbook's own date-range header text (e.g. "Sale No. 30- 04TH AUG / 05TH AUG 2026")
   *  — see computeDefaultRankHeaderText's own comment for why this can't be auto-generated with
   *  full confidence and is offered as an editable field instead. */
  rankHeaderText?: string;
}

const MONTH_NAMES = ["JANUARY", "FEBRUARY", "MARCH", "APRIL", "MAY", "JUNE", "JULY", "AUGUST", "SEPTEMBER", "OCTOBER", "NOVEMBER", "DECEMBER"];

/** Best-effort default for the RANK workbook's date-range header cell — real archived RANK
 *  files show a "{prev day}TH {MONTH} / {sale day}TH {MONTH} {YEAR}" range (the two days the
 *  sale ran across), but every real example has its own inconsistent spacing/abbreviation
 *  ("27THJULY" with no space, "04TH AUG" abbreviated vs "15TH  JULY" spelled out) — this text
 *  was clearly typed by hand each week, not produced by one fixed rule, so no formula can
 *  reproduce it byte-for-byte every time. This computes a clean, consistent version from the
 *  sale date as a starting point; the field that uses it stays user-editable so it can always be
 *  corrected to match exactly when needed. */
export function computeDefaultRankHeaderText(saleDate: string | null, saleNumber: number | null): string {
  if (!saleDate || saleNumber == null) return "";
  const [dd, mm, yyyy] = saleDate.split("/").map(Number);
  if (!dd || !mm || !yyyy) return "";
  const saleDay = new Date(yyyy, mm - 1, dd);
  const prevDay = new Date(saleDay);
  prevDay.setDate(prevDay.getDate() - 1);
  const fmt = (d: Date) => `${String(d.getDate()).padStart(2, "0")}TH ${MONTH_NAMES[d.getMonth()]}`;
  return `Sale No. ${saleNumber}- ${fmt(prevDay)} / ${fmt(saleDay)} ${saleDay.getFullYear()}`;
}

/** overrides.saleDate/saleNumber, when given, replace the values parsed from the TXT for the
 *  report header (B5) and filenames — for the rare week where the TXT's own header is missing,
 *  malformed, or just needs correcting by hand. The TXT/WES mismatch check below still compares
 *  the two files' OWN parsed sale numbers, since that check is about catching a wrong-file
 *  upload, not about the override. */
export async function runJob(txtText: string, wesArrayBuffer: ArrayBuffer, overrides: SaleOverrides = {}): Promise<WeeklyJobResult> {
  const txtReport = parseTxt(txtText);
  const wesReport = await parseWes(wesArrayBuffer);

  const warnings = [...txtReport.warnings, ...wesReport.warnings];

  if (txtReport.saleNumber && wesReport.saleNumber && txtReport.saleNumber !== wesReport.saleNumber) {
    warnings.push(`Sale number mismatch: TXT says sale ${txtReport.saleNumber}, WES file says sale ${wesReport.saleNumber}. Double-check you uploaded matching files for the same week.`);
  }

  const saleNumber = overrides.saleNumber != null && overrides.saleNumber !== "" ? (overrides.saleNumber as number) : txtReport.saleNumber;
  const saleDate = overrides.saleDate || txtReport.saleDate;
  // The sale date/number fields auto-fill from the TXT as soon as it's uploaded (so most weeks
  // need no action there) — so their being non-empty doesn't mean the user typed something.
  // Only warn when the field's value actually differs from what the TXT itself parsed to, i.e.
  // a real correction was made.
  const dateOverridden = !!overrides.saleDate && overrides.saleDate !== txtReport.saleDate;
  const numberOverridden = overrides.saleNumber != null && overrides.saleNumber !== "" && overrides.saleNumber !== txtReport.saleNumber;
  if (dateOverridden || numberOverridden) {
    warnings.push("Sale date/number was entered manually and overrides what was parsed from the TXT.");
  }

  let year: string;
  if (saleDate) {
    year = saleDate.split("/").pop()!;
  } else {
    year = "0000";
    warnings.push("Could not determine sale year from TXT; filenames will use '0000'.");
  }

  const saleLabel = saleNumber != null ? String(saleNumber) : "X";

  const outcomes: CategoryOutcome[] = [];
  for (const category of Object.keys(CATEGORY_SPEC)) {
    const spec = CATEGORY_SPEC[category];
    const catWarnings: string[] = [];
    const filename = `FACT${saleLabel}${year}${spec.suffix}.xlsx`;

    if (!(category in wesReport.categories)) {
      catWarnings.push(`'${category}' not found in the WES file — file not generated.`);
      outcomes.push({ category, filename, buffer: null, rowCount: 0, benchmark: [null, null, null], warnings: catWarnings, ok: false });
      continue;
    }
    const estateRows = wesReport.categories[category];

    const bench = txtReport.categories[category];
    const benchmark: [number | null, number | null, number | null] = bench ? [bench.sale_avg, bench.mtd_avg, bench.ytd_avg] : [null, null, null];
    if (!bench) catWarnings.push(`'${category}-OTHODOX' not found in TXT — Elevation Avr row will be blank.`);

    const result = await buildCategoryWorkbook({ templateKey: spec.templateKey, estateRows, benchmark, saleDate, saleNumber });
    catWarnings.push(...result.warnings);

    outcomes.push({ category, filename, buffer: result.buffer, rowCount: result.rowCount, benchmark, warnings: catWarnings, ok: !!bench && estateRows.length > 0 });
  }

  const rankHeaderText = overrides.rankHeaderText?.trim() || computeDefaultRankHeaderText(saleDate, saleNumber);

  let rankWorkbook: WeeklyJobResult["rankWorkbook"] = null;
  const rankWarnings: string[] = [];
  try {
    const rankResult = await buildRankWorkbook({ txtReport, wesReport, wesArrayBuffer, rankHeaderText, saleLabel, year });
    rankWorkbook = { filename: rankResult.filename, buffer: rankResult.buffer, ok: true };
    rankWarnings.push(...rankResult.warnings);
  } catch (err) {
    rankWorkbook = { filename: null, buffer: null, ok: false };
    rankWarnings.push(`RANK workbook could not be built: ${err instanceof Error ? err.message : String(err)}`);
  }

  return { saleNumber, saleDate, outcomes, rankWorkbook, rankWarnings, warnings };
}
