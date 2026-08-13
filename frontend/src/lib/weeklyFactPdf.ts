"use client";

/* =====================================================================
   WEEKLY FACT REPORTS — PDF mirrors of the generated Excel workbooks
   ---------------------------------------------------------------------
   One PDF per FACT category workbook, plus one PDF for the combined
   RANK workbook (a page-run per category tab, in the workbook's own tab
   order). Each mirrors its Excel counterpart's structure — the same
   letterhead lines, the same two-tier column headers with the same
   merges (rendered as col/row spans), the same rows in the same order,
   the FACT sheet's closing "Elevation Avr" row, and the RANK sheets'
   benchmark cells, above/below legend and row coloring — rendered with
   the app's established jsPDF + autotable stack (see worksheetPdf.ts /
   combinedReportExport.ts).

   Content comes from WeeklyJobResult's sortedRows/rankTabs — the exact
   arrays the workbooks were written from — never from re-parsing, so
   the PDF and the Excel can't disagree. Sheet1 (the RANK workbook's raw
   WES working copy) is intentionally not rendered: it's an internal
   working reference, not part of the client-facing report.
   ===================================================================== */

import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { loadImage } from "@/lib/worksheetPdf";
import type { CategoryOutcome, RankTabData, RawValue } from "@/lib/weeklyFactReport";

// Letterhead lines exactly as they appear in the FACT/RANK templates (rows 1-4 / 2-7).
const COMPANY_NAME = "ASIA SIYAKA COMMODITIES  PLC";
const COMPANY_ADDRESS = '"DEUTSCHE HOUSE", 320, T.B. Jayah Mawatha, Colombo 10.';
const COMPANY_TEL = "Tel: 2678146 / 4600700 Fax: 2678145";
const COMPANY_WEB = "Website: www.asiasiyaka.com Email: tea@siyaka.lk";
const RANK_SUBTITLE = "WEEKLY & TODATE SOLD QTY & AVERAGES";

// The RANK workbook's own above/below colors (read off a real manually-built workbook —
// see weeklyFactReport.ts's RANK_* constants, same values minus the alpha prefix).
const ABOVE_FILL: [number, number, number] = [0xae, 0xaa, 0xaa];
const ABOVE_TEXT: [number, number, number] = [0, 0, 0];
const BELOW_TEXT: [number, number, number] = [0xff, 0, 0];

const MARGIN = 40;

/** Excel shows a blank for the WES source's whitespace-padded "empty" cells; so does the PDF.
 *  Numbers get thousands separators; averages always carry 2 decimals like the sheets'
 *  number formats. */
function fmtQty(v: RawValue): string {
  if (v == null) return "";
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 2 });
  const s = String(v).trim();
  return s === "" ? "" : s;
}

function fmtAvg(v: RawValue): string {
  if (v == null) return "";
  if (typeof v === "number") return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const s = String(v).trim();
  return s === "" ? "" : s;
}

function fmtRank(v: RawValue): string {
  if (v == null) return "";
  const s = String(v).trim();
  return s;
}

type Logo = Awaited<ReturnType<typeof loadImage>>;

/** Letterhead: logo top-left (when available), the template's four company lines beside it,
 *  and an optional right-aligned block label (FACT's "RANKING / {CATEGORY}" box). Returns the
 *  y where content below the letterhead starts. */
function drawLetterhead(doc: jsPDF, logo: Logo, lines: string[], rightLabel?: string[]): number {
  let textX = MARGIN;
  if (logo) {
    const ratio = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1.5;
    const logoH = 40;
    doc.addImage(logo.dataUrl, "PNG", MARGIN, 14, logoH * ratio, logoH);
    textX = MARGIN + logoH * ratio + 14;
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(0, 0, 0);
  doc.text(lines[0], textX, 26);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  lines.slice(1).forEach((line, i) => doc.text(line, textX, 38 + i * 10));

  if (rightLabel?.length) {
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    rightLabel.forEach((line, i) => doc.text(line, pageW - MARGIN, 28 + i * 15, { align: "right" }));
  }

  return 38 + (lines.length - 1) * 10 + 14;
}

/** One FACT category workbook's PDF mirror: letterhead + "{date} - Sale {N}" line, the
 *  sheet's two-tier Estate/Factory/Week/Month/Year/Rank header, every estate row in workbook
 *  order, and the closing bold "Elevation Avr" row with its three benchmark averages in the
 *  same columns (Week/Month/Year GSA Avg). */
export async function buildFactCategoryPdf(outcome: CategoryOutcome, saleDate: string | null, saleNumber: number | null): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const logo = await loadImage("/brand/tea-auction-logo.png");

  const startY = drawLetterhead(doc, logo, [COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TEL, COMPANY_WEB], ["RANKING", outcome.category]);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  if (saleDate && saleNumber != null) doc.text(`${saleDate} - Sale ${saleNumber}`, MARGIN, startY);

  // Template rows 6-8 flattened to the same spans: Estate and Factory each span both header
  // rows (A7:A8 / B6:B8), Week / Month Todate / Year Todate each cover a qty+avg pair
  // (C6:D7, E6:F6, G6:H6), Rank covers its three sub-columns (I6:K6).
  const head: RowInput[] = [
    [
      { content: "Estate", rowSpan: 2 },
      { content: "Factory", rowSpan: 2 },
      { content: "Week", colSpan: 2 },
      { content: "Month Todate", colSpan: 2 },
      { content: "Year Todate", colSpan: 2 },
      { content: "Rank", colSpan: 3 },
    ],
    ["Qty sold", "GSA Avg", "Qty sold", "GSA Avg", "Qty sold", "GSA Avg", "Week", "Month", "Year"],
  ];

  const body: RowInput[] = outcome.sortedRows.map((r) => [
    r.estate.trim(),
    r.code.trim(),
    fmtQty(r.week_qty),
    fmtAvg(r.week_avg),
    fmtQty(r.month_qty),
    fmtAvg(r.month_avg),
    fmtQty(r.year_qty),
    fmtAvg(r.year_avg),
    fmtRank(r.week_rank),
    fmtRank(r.month_rank),
    fmtRank(r.year_rank),
  ]);

  // The sheet's closing row: "Elevation Avr" merged across Estate+Factory, the sale average
  // merged across the Week pair, MTD/YTD under the Month/Year GSA Avg columns.
  const [saleAvg, mtdAvg, ytdAvg] = outcome.benchmark;
  const foot: RowInput[] = [
    [
      { content: "Elevation Avr", colSpan: 2, styles: { fontStyle: "bold", halign: "left" } },
      { content: fmtAvg(saleAvg), colSpan: 2, styles: { fontStyle: "bold" } },
      "",
      { content: fmtAvg(mtdAvg), styles: { fontStyle: "bold" } },
      "",
      { content: fmtAvg(ytdAvg), styles: { fontStyle: "bold" } },
      "",
      "",
      "",
    ],
  ];

  autoTable(doc, {
    head,
    body,
    foot,
    startY: startY + 8,
    margin: { left: MARGIN, right: MARGIN },
    theme: "grid",
    styles: { fontSize: 7.5, cellPadding: 2.5, halign: "right", textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.5 },
    headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", halign: "center" },
    footStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0] },
    columnStyles: {
      0: { halign: "left", cellWidth: 130 },
      1: { halign: "left", cellWidth: 60 },
    },
  });

  return doc.output("blob");
}

/** The combined RANK workbook's PDF mirror: one page-run per category tab in the workbook's
 *  own tab order, each with the RANK letterhead (title/subtitle/date-range header), the two
 *  benchmark lines (J10/J11), the above/below legend, and the tab's Factory/MF Code/Weekly/
 *  Month-Todate/DEF/Rank table with the workbook's own above/below row coloring. Sheet1 (raw
 *  WES copy) is deliberately omitted — a working reference, not report content. */
export async function buildRankPdf(tabs: RankTabData[], rankHeaderText: string): Promise<Blob> {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  const logo = await loadImage("/brand/tea-auction-logo.png");

  tabs.forEach((tab, tabIndex) => {
    if (tabIndex > 0) doc.addPage();

    const headerLines = [COMPANY_NAME, RANK_SUBTITLE, ...(rankHeaderText ? [rankHeaderText] : []), COMPANY_ADDRESS, COMPANY_TEL, COMPANY_WEB];
    const y = drawLetterhead(doc, logo, headerLines);

    const [saleAvg, mtdAvg] = tab.benchmark;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(tab.category, MARGIN, y + 2);

    // Benchmark cells (G10/J10, G11/J11 on the sheet), right-aligned as a small block.
    const pageW = doc.internal.pageSize.getWidth();
    doc.setFontSize(8);
    doc.text(`WEEKLY O/X LG AVG   ${fmtAvg(saleAvg)}`, pageW - MARGIN, y - 8, { align: "right" });
    doc.text(`MONTH TODATE O/X LG AVG   ${fmtAvg(mtdAvg)}`, pageW - MARGIN, y + 2, { align: "right" });

    // The sheet's own legend (H13:I14).
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setFillColor(...ABOVE_FILL);
    doc.rect(MARGIN, y + 8, 8, 8, "F");
    doc.setTextColor(0, 0, 0);
    doc.text("Above the Average", MARGIN + 12, y + 15);
    doc.setDrawColor(0, 0, 0);
    doc.rect(MARGIN + 100, y + 8, 8, 8, "S");
    doc.setTextColor(...BELOW_TEXT);
    doc.text("Below the average", MARGIN + 112, y + 15);
    doc.setTextColor(0, 0, 0);

    // Rows 16-17 flattened to the same spans: FACTORY (B16:B17), MF CODE, WEEKLY over
    // qty/avg/rank (D16:F16), MONTH TODATE over qty/avg (G16:H16), DEF +/- (I16:I17),
    // RANK (J16:J17).
    const head: RowInput[] = [
      [
        { content: "FACTORY", rowSpan: 2 },
        { content: "MF CODE", rowSpan: 2 },
        { content: "WEEKLY", colSpan: 3 },
        { content: "MONTH TODATE", colSpan: 2 },
        { content: "DEF +/-", rowSpan: 2 },
        { content: "RANK", rowSpan: 2 },
      ],
      ["QTY", "AVG", "RANK", "QTY", "AVG"],
    ];

    const body: RowInput[] = tab.rows.map((r) => {
      // Same DEF arithmetic as buildRankCategorySheet, including its ToNumber coercion.
      const defVal = r.month_avg != null && mtdAvg != null ? Number(r.month_avg) - mtdAvg : null;
      const above = defVal != null ? defVal >= 0 : true;
      const styles = above
        ? { fillColor: ABOVE_FILL, textColor: ABOVE_TEXT }
        : { fillColor: [255, 255, 255] as [number, number, number], textColor: BELOW_TEXT };
      const cells = [
        r.estate.trim(),
        r.code.trim(),
        fmtQty(r.week_qty),
        fmtAvg(r.week_avg),
        fmtRank(r.week_rank),
        fmtQty(r.month_qty),
        fmtAvg(r.month_avg),
        defVal != null && Number.isFinite(defVal) ? fmtAvg(defVal) : "",
        fmtRank(r.month_rank),
      ];
      return cells.map((content) => ({ content, styles }));
    });

    autoTable(doc, {
      head,
      body,
      startY: y + 24,
      margin: { left: MARGIN, right: MARGIN },
      theme: "grid",
      styles: { fontSize: 7.5, cellPadding: 2.5, halign: "right", lineColor: [0, 0, 0], lineWidth: 0.5 },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { halign: "left", cellWidth: 150 },
        1: { halign: "left", cellWidth: 70 },
      },
    });
  });

  return doc.output("blob");
}
