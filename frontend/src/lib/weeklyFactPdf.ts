"use client";

/* =====================================================================
   MARKET SHARE PDFs — jsPDF mirrors of the generated MARKET SHARE workbook
   ---------------------------------------------------------------------
   The FACT category / RANK / LOW RANK / LOW MARK PDFs used to live here too,
   hand-drawn with jsPDF + autotable as an approximation of the Excel sheets.
   They've been replaced by a real xlsx→PDF conversion (LibreOffice headless,
   see frontend/src/app/api/weekly-fact/pdf/route.ts, wired up from
   reports/weekly-fact/page.tsx via api.convertWeeklyFactPdf) so those PDFs
   are pixel-for-pixel what Excel's own File > Export > Create PDF would
   produce from the same workbook, not a redrawn lookalike.

   MARKET SHARE stays on the jsPDF path: it has no equivalent print-ready
   xlsx sheet to convert (buildMarketShareWorkbook writes plain data rows,
   not a formatted print layout), so it's built directly from the same rows
   the workbook was written from — content can't disagree with the workbook
   even though the rendering pipeline differs from the other reports.
   ===================================================================== */

import { jsPDF } from "jspdf";
import autoTable, { type RowInput } from "jspdf-autotable";
import { loadImage } from "@/lib/worksheetPdf";
import type { MarketShareCompareRow } from "@/lib/weeklyFactReport";

// Letterhead lines exactly as they appear in the FACT/RANK templates (rows 1-4 / 2-7).
const COMPANY_NAME = "ASIA SIYAKA COMMODITIES  PLC";
const COMPANY_ADDRESS = '"DEUTSCHE HOUSE", 320, T.B. Jayah Mawatha, Colombo 10.';
const COMPANY_TEL = "Tel: 2678146 / 4600700 Fax: 2678145";
const COMPANY_WEB = "Website: www.asiasiyaka.com Email: tea@siyaka.lk";

const MARGIN = 40;

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

/** One MARKET SHARE table's rows, exactly as written to the workbook (ranked, top-8) — the
 *  PDF renders straight from these, same contract as the other mirrors. */
export interface MarketShareTablePdfData {
  title: string;
  rows: { code: string; qty: number }[];
}

// The template's own top-3 highlight (verified off the real archived cell fills — see
// weeklyFactReport.ts's MARKET_SHARE_TABLES comment).
const MARKET_SHARE_HIGHLIGHT: [number, number, number] = [0xff, 0xff, 0x00];

// A broker's qty is occasionally a non-integer (e.g. 587422.5 — the underlying catalogued-
// totals sheet averages some PVT rows into a factory's Fresh Qty), but the archived reports
// always display whole quantities. Verified against the real archive (sale 35's compare PDF):
// this rounds half AWAY FROM ZERO — e.g. 587422.5 → 587,423 and a diff of -7203.5 → -7,204 —
// not JS's Math.round (which rounds .5 toward +Infinity, giving the wrong sign on a negative
// half) and not the workbook's own cell number-format rounding (Excel handles that natively;
// jsPDF has no equivalent, so it must be done explicitly before display here).
const roundHalfAwayFromZero = (n: number) => (n < 0 ? -Math.round(-n) : Math.round(n));

/** The MARKET SHARE workbook's PDF mirror: one page (spilling to a second if it runs long),
 *  the four tables in the workbook's own order (Total / Ex-Estate / High & Medium / Low),
 *  each ranked by qty with the top 3 rows highlighted exactly like the source cells. % is
 *  recomputed from the same rows the workbook itself sums (its own table total), so the two
 *  can never disagree. */
export async function buildMarketSharePdf(tables: MarketShareTablePdfData[], saleNumber: number | null): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const logo = await loadImage("/brand/tea-auction-logo.png");

  let y = drawLetterhead(doc, logo, [COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TEL, COMPANY_WEB]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text(`MARKET SHARE${saleNumber != null ? ` — Sale ${saleNumber}` : ""}`, MARGIN, y);
  y += 14;

  const pageBottom = doc.internal.pageSize.getHeight() - MARGIN;

  tables.forEach((table) => {
    if (y > pageBottom - 100) {
      doc.addPage();
      y = MARGIN;
    }
    const totalQty = table.rows.reduce((sum, r) => sum + r.qty, 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(table.title, MARGIN, y);

    const head: RowInput[] = [["", "BROKER", "%", "QTY."]];
    const body: RowInput[] = table.rows.map((r, i) => {
      const pct = totalQty > 0 ? (r.qty / totalQty) * 100 : 0;
      const styles = i < 3 ? { fillColor: MARKET_SHARE_HIGHLIGHT } : {};
      return [
        { content: String(i + 1), styles },
        { content: r.code, styles },
        { content: pct.toFixed(2), styles },
        { content: roundHalfAwayFromZero(r.qty).toLocaleString("en-US"), styles },
      ];
    });

    autoTable(doc, {
      head,
      body,
      startY: y + 8,
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: 280,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 3, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.5 },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { halign: "center", cellWidth: 22 },
        1: { halign: "left", cellWidth: 70 },
        2: { halign: "right", cellWidth: 80 },
        3: { halign: "right", cellWidth: 100 },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lastAutoTable isn't in jsPDF's own types; added by the autotable plugin at runtime
    y = (doc as any).lastAutoTable.finalY + 26;
  });

  return doc.output("blob");
}

/** One MARKET SHARE compare table's rows, exactly as written by buildMarketShareCompareRows —
 *  the PDF renders straight from these, same contract as MarketShareTablePdfData. */
export interface MarketShareCompareTablePdfData {
  title: string;
  rows: MarketShareCompareRow[];
}

/** The MARKET SHARE compare PDF — same letterhead/table order/top-3 highlight as
 *  buildMarketSharePdf, but each table gains a "Last Week" qty column and a +/- diff column
 *  (mirroring the real archived "MARKET SHARE COMPARE REPORTS" PDF). % is recomputed from the
 *  same this-week rows the workbook itself ranks by, so it can never disagree with the plain
 *  report for the same sale. */
export async function buildMarketShareComparePdf(
  tables: MarketShareCompareTablePdfData[],
  saleNumber: number | null,
  previousSaleNumber: number | null
): Promise<Blob> {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const logo = await loadImage("/brand/tea-auction-logo.png");

  let y = drawLetterhead(doc, logo, [COMPANY_NAME, COMPANY_ADDRESS, COMPANY_TEL, COMPANY_WEB]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  const header =
    saleNumber != null
      ? `MARKET SHARE — Sale ${saleNumber}${previousSaleNumber != null ? ` vs Sale ${previousSaleNumber}` : ""}`
      : "MARKET SHARE";
  doc.text(header, MARGIN, y);
  y += 14;

  const pageBottom = doc.internal.pageSize.getHeight() - MARGIN;

  tables.forEach((table) => {
    if (y > pageBottom - 100) {
      doc.addPage();
      y = MARGIN;
    }
    const totalQty = table.rows.reduce((sum, r) => sum + r.qty, 0);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.text(table.title, MARGIN, y);

    const head: RowInput[] = [["", "BROKER", "%", "QTY. (This Week)", "QTY. (Last Week)", "+/-"]];
    const body: RowInput[] = table.rows.map((r, i) => {
      const pct = totalQty > 0 ? (r.qty / totalQty) * 100 : 0;
      // The top-3 yellow highlight covers rank/broker/%/qty-this-week here (verified against
      // the archived compare PDF's actual highlight rectangle geometry, sale 35: it spans from
      // the rank column through the end of the QTY. (This Week) column and stops before QTY.
      // (Last Week)) — only the last-week qty and diff columns stay unhighlighted.
      const rankStyles = i < 3 ? { fillColor: MARKET_SHARE_HIGHLIGHT } : {};
      const diff = roundHalfAwayFromZero(r.diff);
      const diffStyles = diff < 0 ? { textColor: [200, 0, 0] as [number, number, number] } : {};
      return [
        { content: String(i + 1), styles: rankStyles },
        { content: r.code, styles: rankStyles },
        { content: pct.toFixed(2), styles: rankStyles },
        { content: roundHalfAwayFromZero(r.qty).toLocaleString("en-US"), styles: rankStyles },
        { content: roundHalfAwayFromZero(r.lastQty).toLocaleString("en-US") },
        { content: diff.toLocaleString("en-US"), styles: diffStyles },
      ];
    });

    autoTable(doc, {
      head,
      body,
      startY: y + 8,
      margin: { left: MARGIN, right: MARGIN },
      tableWidth: 380,
      theme: "grid",
      styles: { fontSize: 8.5, cellPadding: 3, textColor: [0, 0, 0], lineColor: [0, 0, 0], lineWidth: 0.5 },
      headStyles: { fillColor: [255, 255, 255], textColor: [0, 0, 0], fontStyle: "bold", halign: "center" },
      columnStyles: {
        0: { halign: "center", cellWidth: 22 },
        1: { halign: "left", cellWidth: 60 },
        2: { halign: "right", cellWidth: 60 },
        3: { halign: "right", cellWidth: 80 },
        4: { halign: "right", cellWidth: 80 },
        5: { halign: "right", cellWidth: 78 },
      },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- lastAutoTable isn't in jsPDF's own types; added by the autotable plugin at runtime
    y = (doc as any).lastAutoTable.finalY + 26;
  });

  return doc.output("blob");
}
