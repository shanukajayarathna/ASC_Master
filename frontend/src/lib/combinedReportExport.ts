"use client";

/* =====================================================================
   COMBINED REPORT (Top Prices / CTC / Off Grades & Dust / Low Grown &
   Premium Flowery) — EXCEL + PDF EXPORT
   ---------------------------------------------------------------------
   Line-for-line port of the original standalone app's report-common.js
   (addSheetToWorkbook/writeBlockAtColumn for Excel via ExcelJS,
   drawBlockColumn/paintBlockTitle/exportPdfReport for PDF via jsPDF +
   autotable) — same technology as the original, so there is nothing to
   re-derive: colors, borders, fonts, row heights, column widths, page
   setup and the letterhead layout are all reproduced exactly. The one
   deliberate adaptation: the original requires the user to type a Sale
   No into a toolbar field before exporting; this app already knows the
   sale (the picked catalogue), so the number is extracted from its
   sourceName ("Sale 30 - 2026" -> "30") instead of asked for again.
   ===================================================================== */

import type { AuctionReport, GradeBlock, RankedLotRow, ReportBlock } from "@/types/api";
import { loadImage } from "@/lib/worksheetPdf";
import ExcelJS from "exceljs";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

// ASC's own broker code — matches TopPriceEngine.OurBroker on the backend (which is what
// "isOurs" on each row was computed against), and the original's own default `ascCode` ('ASC').
const ASC_CODE = "ASC";

// Ported verbatim from combined.js's `reports.exports` table — title text (shown in the Excel/
// PDF letterhead) and filename prefix are per report family, independent of whatever label this
// app's own UI tab happens to show.
const REPORT_EXPORT_META: Record<string, { title: string; prefix: string }> = {
  "top-prices": { title: "UH, UM & WH, WM Report", prefix: "top-prices-report" },
  ctc: { title: "CTC Report", prefix: "ctc-report" },
  "off-grades-dust": { title: "Off Grades & Dust Report", prefix: "off-grades-dust-report" },
  "low-grown-premium-flowery": { title: "Low Grown & Premium Flowery Report", prefix: "low-grown-premium-flowery-report" },
};

function exportMetaFor(report: AuctionReport): { title: string; prefix: string } {
  return REPORT_EXPORT_META[report.reportKey] ?? { title: report.title, prefix: report.reportKey };
}

/** The picked sale's sourceName is always "Sale {N} - {year}" (SaleFileStore.LoadCatalogues) —
 *  extracted here instead of asking the user to retype the number the original's toolbar field
 *  wanted, since this app already knows which sale is active. */
function extractSaleNumber(sourceName: string): string {
  const m = /Sale\s+(\d+)/i.exec(sourceName);
  return m ? m[1] : sourceName;
}

function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

const fmt2 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ---- EXCEL EXPORT (ExcelJS) -----------------------------------------------------------------

const BOLD_BORDER: Partial<ExcelJS.Borders> = {
  top: { style: "medium", color: { argb: "FF0B2545" } },
  left: { style: "medium", color: { argb: "FF0B2545" } },
  bottom: { style: "medium", color: { argb: "FF0B2545" } },
  right: { style: "medium", color: { argb: "FF0B2545" } },
};
const HIGHLIGHT_GREEN = "FFC6EFCE";
const CENTERED: Partial<ExcelJS.Alignment> = { horizontal: "center", vertical: "middle" };
const TABLE_ROW_HEIGHT = 24;
const BODY_FONT_SIZE = 12;
const HEADER_FONT_SIZE = 12;

function blockHeaders(includeElevation: boolean): string[] {
  return includeElevation
    ? ["Broker", "Selling Mark", "Grade", "Sub Elevation", "Purchased Price", "Buyer"]
    : ["Broker", "Selling Mark", "Grade", "Purchased Price", "Buyer"];
}

/** Writes one block (e.g. the "UH" table) starting at a given column/row as ONE continuous
 *  table: title bar, a single header row, then every grade's rows with one empty spacer row
 *  between grades. Everything is centre-aligned and bold-bordered; our broker's rows are filled
 *  light green. Returns the next free row. */
function writeBlockAtColumn(ws: ExcelJS.Worksheet, block: ReportBlock, includeElevation: boolean, startCol: number, startRow: number): number {
  const headers = blockHeaders(includeElevation);
  const priceOffset = includeElevation ? 4 : 3; // 0-based index of Purchased Price within a row's values
  let row = startRow;

  ws.mergeCells(row, startCol, row, startCol + headers.length - 1);
  const titleCell = ws.getCell(row, startCol);
  titleCell.value = block.title;
  titleCell.font = { bold: true, size: 14, color: { argb: "FFFFFFFF" } };
  titleCell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0B2545" } };
  titleCell.alignment = CENTERED;
  titleCell.border = BOLD_BORDER;
  ws.getRow(row).height = 26;
  row += 1;

  const gradeBlocks: GradeBlock[] = block.grades;
  if (!gradeBlocks.length) {
    const cell = ws.getCell(row, startCol);
    cell.value = "No matching data for this section.";
    cell.font = { italic: true, size: BODY_FONT_SIZE, color: { argb: "FF8A97AC" } };
    cell.alignment = CENTERED;
    return row + 1;
  }

  headers.forEach((h, i) => {
    const cell = ws.getCell(row, startCol + i);
    cell.value = h;
    cell.font = { bold: true, size: HEADER_FONT_SIZE, color: { argb: "FFFFFFFF" } };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF0F4C81" } };
    cell.alignment = CENTERED;
    cell.border = BOLD_BORDER;
  });
  ws.getRow(row).height = TABLE_ROW_HEIGHT;
  row += 1;

  gradeBlocks.forEach((g, gradeIdx) => {
    if (gradeIdx > 0) {
      for (let spacer = 0; spacer < 2; spacer++) {
        headers.forEach((_h, i) => {
          const cell = ws.getCell(row, startCol + i);
          cell.value = "";
          cell.border = BOLD_BORDER;
        });
        ws.getRow(row).height = TABLE_ROW_HEIGHT;
        row += 1;
      }
    }
    g.rows.forEach((item: RankedLotRow) => {
      const rowValues: (string | number)[] = includeElevation
        ? [item.broker, item.sellingMark, item.grade, item.subElevation ?? "", item.price, item.buyer ?? ""]
        : [item.broker, item.sellingMark, item.grade, item.price, item.buyer ?? ""];
      rowValues.forEach((val, i) => {
        const cell = ws.getCell(row, startCol + i);
        cell.value = val;
        cell.border = BOLD_BORDER;
        cell.alignment = CENTERED;
        cell.font = { size: BODY_FONT_SIZE, bold: !!item.isOurs };
        if (i === priceOffset) cell.numFmt = "#,##0.00";
        if (item.isOurs) {
          cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: HIGHLIGHT_GREEN } };
        }
      });
      ws.getRow(row).height = TABLE_ROW_HEIGHT;
      row += 1;
    });
  });

  return row;
}

async function addSheetToWorkbook(
  workbook: ExcelJS.Workbook,
  title: string,
  blocks: ReportBlock[],
  includeElevation: boolean,
  headerMeta: { reportTitle: string; saleNumber: string },
  logo: { dataUrl: string; width: number; height: number } | null
): Promise<void> {
  const ws = workbook.addWorksheet(title.slice(0, 31).replace(/[*?:/\\[\]]/g, ""));
  const headers = blockHeaders(includeElevation);
  const totalCols = headers.length;

  // Letterhead like the valuation report: company logo floats top-left over rows 1-3, with the
  // heading text merged from column C so the two never overlap.
  const textStartCol = Math.min(3, totalCols);
  if (logo) {
    const imageId = workbook.addImage({ base64: logo.dataUrl.split(",")[1], extension: "png" });
    const ratio = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1.5;
    const imgH = 60;
    ws.addImage(imageId, { tl: { col: 0.1, row: 0.15 }, ext: { width: Math.round(imgH * ratio), height: imgH } });
  }

  ws.mergeCells(1, textStartCol, 1, totalCols);
  const companyCell = ws.getCell(1, textStartCol);
  companyCell.value = "ASIA SIYAKA COMMODITIES PLC";
  companyCell.font = { bold: true, size: 15, color: { argb: "FF0B2545" } };
  companyCell.alignment = { vertical: "middle" };
  ws.getRow(1).height = 26;

  ws.mergeCells(2, textStartCol, 2, totalCols);
  const topicCell = ws.getCell(2, textStartCol);
  topicCell.value = `${headerMeta.reportTitle} — Sale ${headerMeta.saleNumber}`;
  topicCell.font = { bold: true, size: 11, color: { argb: "FF0F4C81" } };

  ws.mergeCells(3, textStartCol, 3, totalCols);
  const genCell = ws.getCell(3, textStartCol);
  genCell.value = `Generated ${new Date().toLocaleString()}`;
  genCell.font = { italic: true, size: 9, color: { argb: "FF8A97AC" } };

  let cursorRow = 5;
  blocks.forEach((block) => {
    cursorRow = writeBlockAtColumn(ws, block, includeElevation, 1, cursorRow) + 1;
  });

  for (let c = 1; c <= totalCols; c++) ws.getColumn(c).width = 21;

  // A4 portrait, scaled to fit the page width (never the height) — every block is exactly one
  // column-width wide, so this rarely has to scale anything down; it's a safety net.
  ws.pageSetup = {
    orientation: "portrait",
    paperSize: 9, // ISO A4
    fitToPage: true,
    fitToWidth: 1,
    fitToHeight: 0,
    margins: { left: 0.4, right: 0.4, top: 0.5, bottom: 0.5, header: 0.2, footer: 0.2 },
  };
}

export async function exportCombinedReportExcel(report: AuctionReport): Promise<void> {
  const { title: reportTitle, prefix } = exportMetaFor(report);
  const saleNumber = extractSaleNumber(report.sourceName);
  const logo = await loadImage("/brand/tea-auction-logo.png");

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Asia Siyaka Commodities";
  workbook.created = new Date();

  for (const sheet of report.sheets) {
    await addSheetToWorkbook(workbook, sheet.title, sheet.blocks, sheet.includeElevation, { reportTitle, saleNumber }, logo);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${prefix}-sale-${saleNumber}-${dateStamp()}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

// ---- PDF EXPORT (jsPDF + autotable) ---------------------------------------------------------

const BLOCK_TITLE_H = 26; // title bar (24pt) + the small gap under it

function paintBlockTitle(doc: jsPDF, block: ReportBlock, colStartX: number, colWidth: number, y: number): void {
  doc.setFillColor(11, 37, 69);
  doc.rect(colStartX, y - 13, colWidth, 24, "F");
  doc.setFontSize(13);
  doc.setTextColor(255, 255, 255);
  doc.text(String(block.title), colStartX + colWidth / 2, y + 4, { align: "center" });
}

/** Draws one block as a single continuous table inside a fixed-width column starting at
 *  colStartX. Returns the Y position it finished at, so the caller can stack the next block
 *  directly beneath it. `pageTopMargin` lets a block that spans a page break repaint its own
 *  title bar on every continuation page (autoTable only repeats the column header by default). */
function drawBlockColumn(
  doc: jsPDF,
  block: ReportBlock,
  includeElevation: boolean,
  colStartX: number,
  colWidth: number,
  startY: number,
  pageTopMargin: number
): number {
  let cursorY = startY;
  paintBlockTitle(doc, block, colStartX, colWidth, cursorY);
  cursorY += BLOCK_TITLE_H;

  if (!block.grades.length) {
    doc.setFontSize(10);
    doc.setTextColor(140, 150, 165);
    doc.text("No matching data for this section.", colStartX + 4, cursorY + 4);
    return cursorY + 26;
  }

  // No Rank column — rows already print highest price first.
  const head = includeElevation ? [["Broker", "Selling Mark", "Grade", "Sub Elev", "Price", "Buyer"]] : [["Broker", "Selling Mark", "Grade", "Price", "Buyer"]];
  const emptyRow = includeElevation ? ["", "", "", "", "", ""] : ["", "", "", "", ""];

  const body: (string | number)[][] = [];
  const highlightRows: boolean[] = [];
  block.grades.forEach((g, gradeIdx) => {
    if (gradeIdx > 0) body.push(emptyRow, emptyRow);
    g.rows.forEach((item) => {
      highlightRows[body.length] = !!item.isOurs;
      body.push(
        includeElevation
          ? [item.broker, item.sellingMark, item.grade, item.subElevation ?? "", fmt2(item.price), item.buyer ?? ""]
          : [item.broker, item.sellingMark, item.grade, fmt2(item.price), item.buyer ?? ""]
      );
    });
  });

  // Short, fixed-content columns get a fixed width; the text-heavy ones (Broker, Selling Mark,
  // Buyer) share whatever is left, so names stay readable instead of being the first thing
  // ellipsized.
  const columnStyles: Record<number, { cellWidth: number }> = includeElevation
    ? { 2: { cellWidth: 42 }, 3: { cellWidth: 46 }, 4: { cellWidth: 54 } }
    : { 2: { cellWidth: 42 }, 3: { cellWidth: 54 } };

  autoTable(doc, {
    startY: cursorY,
    head,
    body,
    theme: "grid",
    // overflow 'ellipsize' keeps every cell on one line; minCellHeight pins every row to the
    // same height.
    styles: { fontSize: 9, cellPadding: 4, halign: "center", valign: "middle", lineColor: [11, 37, 69], lineWidth: 0.8, overflow: "ellipsize", minCellHeight: 20 },
    headStyles: { fillColor: [15, 76, 129], textColor: 255, halign: "center", fontSize: 9.5, fontStyle: "bold" },
    columnStyles,
    tableLineColor: [11, 37, 69],
    tableLineWidth: 1.4,
    // Reserve room at the top of every page this table touches for the title bar — on a
    // continuation page that space is otherwise just the ordinary page margin, and
    // didDrawPage below paints into it.
    margin: { left: colStartX, right: doc.internal.pageSize.getWidth() - colStartX - colWidth, top: pageTopMargin + BLOCK_TITLE_H },
    tableWidth: colWidth,
    didDrawPage(data) {
      if (data.pageNumber > 1) {
        paintBlockTitle(doc, block, colStartX, colWidth, pageTopMargin + 13);
      }
    },
    didParseCell(data) {
      // Our broker's rows are filled green AND bolded — colour alone is easy to miss on a
      // printed or photocopied page.
      if (data.section === "body" && highlightRows[data.row.index]) {
        data.cell.styles.fillColor = [198, 239, 206];
        data.cell.styles.fontStyle = "bold";
      }
    },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lastAutoTable isn't in jsPDF's own types; added by the autotable plugin at runtime
  return (doc as any).lastAutoTable.finalY + 12;
}

/** A4 portrait, every block full-width and stacked vertically, one sheet per page (or more, if
 *  a sheet's blocks overflow one page). */
export async function exportCombinedReportPdf(report: AuctionReport): Promise<void> {
  const { title: reportTitle, prefix } = exportMetaFor(report);
  const saleNumber = extractSaleNumber(report.sourceName);
  const logo = await loadImage("/brand/tea-auction-logo.png");

  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 40;

  function drawLetterhead(sheet: { title: string }): number {
    let textX = margin;
    if (logo) {
      const ratio = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1.5;
      const logoH = 38;
      const logoW = logoH * ratio;
      doc.addImage(logo.dataUrl, "PNG", margin, 12, logoW, logoH);
      textX = margin + logoW + 16;
    }

    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(11, 37, 69);
    doc.text("ASIA SIYAKA COMMODITIES PLC", textX, 26);
    doc.setFont("helvetica", "normal");

    doc.setFontSize(11);
    doc.setTextColor(11, 37, 69);
    doc.text(`${sheet.title} — ${reportTitle} — Sale ${saleNumber}`, textX, 43);
    doc.setFontSize(8.5);
    doc.setTextColor(90, 100, 120);
    doc.text(`Generated ${new Date().toLocaleString()} • Broker code: ${ASC_CODE}`, textX, 56);
    return 82;
  }

  report.sheets.forEach((sheet, sheetIdx) => {
    if (sheetIdx > 0) doc.addPage();
    let cursorY = drawLetterhead(sheet);

    sheet.blocks.forEach((block) => {
      // Reserve room for the 26pt title bar plus a header row and at least one data row before
      // committing to starting a block here — otherwise it could draw its title bar (or first
      // couple of rows) past the page edge.
      if (cursorY > pageHeight - 110) {
        doc.addPage();
        cursorY = margin;
      }
      cursorY = drawBlockColumn(doc, block, sheet.includeElevation, margin, pageWidth - margin * 2, cursorY, margin);
    });
  });

  doc.save(`${prefix}-sale-${saleNumber}-${dateStamp()}.pdf`);
}
