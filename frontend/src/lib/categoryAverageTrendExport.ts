"use client";

/* =====================================================================
   CATEGORY AVERAGE TREND — EXCEL + PDF EXPORT
   ---------------------------------------------------------------------
   One workbook is built from the report's own data (ExcelJS). "Download Excel" saves it
   as-is; "Download PDF" sends the very same workbook through the shared headless-LibreOffice
   route (api.convertXlsxToPdf), so the PDF is exactly what Excel's own Export to PDF would give.
   The sheet is set to landscape and fitted to one page, so both files always come out as a
   single well-fitted page however many grades a sale happens to have.
   ===================================================================== */

import { api } from "@/lib/api";
import type { CategoryAverageTrend, TrendCell } from "@/types/api";
import ExcelJS from "exceljs";

const NAVY = "FF1F3864";
const CATEGORY_FILL = "FFD9E1F2";
const GREEN = "FF00803C";
const RED = "FFC00000";
const GREY = "FF595959";
const FONT = "Arial"; // explicit, so Excel and the LibreOffice PDF conversion render the same typeface
const THIN: Partial<ExcelJS.Borders> = {
  top: { style: "thin", color: { argb: "FFBFBFBF" } },
  left: { style: "thin", color: { argb: "FFBFBFBF" } },
  bottom: { style: "thin", color: { argb: "FFBFBFBF" } },
  right: { style: "thin", color: { argb: "FFBFBFBF" } },
};

const fmt2 = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "▲ 7.13" / "▼ 22.04" — the text and colour shown in a change cell (null when nothing to compare). */
export function changeDisplay(change: number | null): { text: string; color: "green" | "red" | null } {
  if (change === null) return { text: "", color: null };
  if (change > 0) return { text: `▲ ${fmt2(change)}`, color: "green" };
  if (change < 0) return { text: `▼ ${fmt2(-change)}`, color: "red" };
  return { text: "- 0.00", color: null };
}

export function trendTitle(data: CategoryAverageTrend): string {
  const first = data.sales[0];
  const last = data.sales[data.sales.length - 1];
  const range = first && last && first !== last ? `Sales ${first.saleNo} to ${last.saleNo}` : `Sale ${last?.saleNo ?? ""}`;
  return `Low Grown, Off Grade & Dust Average Price (Rs/kg) - ${range}, ${last?.saleYear ?? ""}`;
}

export function trendSourceNote(data: CategoryAverageTrend): string {
  const sales = data.sales.length ? `${data.sales[0].label} to ${data.sales[data.sales.length - 1].label}` : "";
  const base = data.baseSale ? ` (${data.baseSale} used only as the comparison for the first sale)` : "";
  const brokers = data.broker ? `Broker: ${data.broker} only` : "All brokers";
  return (
    `Source: ASC sale result files, ${sales}${base}. ${brokers}; lots with status Sold or Outsold. ` +
    "Leafy, Semi Leafy, Tippy and Premium Flowery: low grown only (Sub Elevation = L). Off Grade and Dust: all elevations, not only low grown. " +
    "Average = sum of Total Value / sum of Total Weight (kg)."
  );
}

function fileStem(data: CategoryAverageTrend): string {
  const last = data.sales[data.sales.length - 1];
  const broker = data.broker ? `_${data.broker}` : "";
  return `Category-Average-Trend_Sale-${last?.saleNo ?? "x"}-${last?.saleYear ?? ""}${broker}`;
}

export async function buildTrendWorkbook(data: CategoryAverageTrend): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Average Trend", {
    pageSetup: {
      orientation: "landscape",
      paperSize: 9, // A4
      fitToPage: true,
      fitToWidth: 1,
      fitToHeight: 1,
      margins: { left: 0.3, right: 0.3, top: 0.3, bottom: 0.3, header: 0.1, footer: 0.1 },
      horizontalCentered: true,
    },
  });

  const saleCount = data.sales.length;
  const lastCol = 1 + saleCount * 2;

  ws.columns = [
    { width: 44 },
    ...data.sales.flatMap(() => [{ width: 12 }, { width: 13 }]),
  ];

  ws.mergeCells(1, 1, 1, lastCol);
  const title = ws.getCell(1, 1);
  title.value = trendTitle(data);
  title.font = { name: FONT, bold: true, size: 14, color: { argb: NAVY } };
  ws.getRow(1).height = 24;

  ws.mergeCells(2, 1, 2, lastCol);
  const sub = ws.getCell(2, 1);
  sub.value =
    (data.broker ? `Broker: ${data.broker} only. ` : "All brokers. ") +
    "Average = total proceeds / total quantity (Sold + Outsold lots). Change = vs previous sale. Green = plus, red = drop.";
  sub.font = { name: FONT, italic: true, size: 10, color: { argb: GREY } };

  // Header row
  const headerRow = 4;
  const headerValues = ["Grade", ...data.sales.flatMap((s) => [`Sale ${s.saleNo}`, "+/-"])];
  headerValues.forEach((v, i) => {
    const c = ws.getCell(headerRow, i + 1);
    c.value = v;
    c.font = { name: FONT, bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: NAVY } };
    c.alignment = { horizontal: i === 0 ? "left" : "center", vertical: "middle" };
    c.border = THIN;
  });
  ws.getRow(headerRow).height = 20;

  const writeRow = (row: number, label: string, cells: TrendCell[], isCategory: boolean) => {
    const labelCell = ws.getCell(row, 1);
    labelCell.value = label;
    labelCell.font = { name: FONT, bold: isCategory, size: 11 };
    labelCell.alignment = { horizontal: "left", vertical: "middle", indent: isCategory ? 0 : 1 };
    cells.forEach((cell, i) => {
      const avg = ws.getCell(row, 2 + i * 2);
      avg.value = cell.average ?? "-";
      avg.numFmt = "#,##0.00";
      avg.alignment = { horizontal: "right", vertical: "middle" };
      avg.font = { name: FONT, bold: isCategory, size: 11 };
      const chg = ws.getCell(row, 3 + i * 2);
      const d = changeDisplay(cell.change);
      chg.value = d.text;
      chg.alignment = { horizontal: "left", vertical: "middle", indent: 1 };
      chg.font = { name: FONT, bold: d.color !== null, size: 11, color: d.color ? { argb: d.color === "green" ? GREEN : RED } : undefined };
    });
    for (let c = 1; c <= lastCol; c++) {
      const cell = ws.getCell(row, c);
      cell.border = THIN;
      if (isCategory) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CATEGORY_FILL } };
    }
    ws.getRow(row).height = 17;
  };

  let row = headerRow + 1;
  for (const cat of data.categories) {
    writeRow(row++, `${cat.name} (Category Average${cat.lowGrownOnly ? "" : ", all elevations"})`, cat.cells, true);
    for (const g of cat.grades) writeRow(row++, g.grade, g.cells, false);
  }

  row += 1;
  ws.mergeCells(row, 1, row, lastCol);
  const src = ws.getCell(row, 1);
  src.value = trendSourceNote(data);
  src.font = { name: FONT, size: 9, color: { argb: GREY } };
  src.alignment = { wrapText: true, vertical: "top" };
  ws.getRow(row).height = 38;

  ws.views = [{ state: "frozen", xSplit: 1, ySplit: headerRow }];
  return wb.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

function saveBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function downloadTrendExcel(data: CategoryAverageTrend): Promise<void> {
  const buffer = await buildTrendWorkbook(data);
  saveBlob(
    new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${fileStem(data)}.xlsx`,
  );
}

export async function downloadTrendPdf(data: CategoryAverageTrend): Promise<void> {
  const stem = fileStem(data);
  const buffer = await buildTrendWorkbook(data);
  const pdf = await api.convertXlsxToPdf(buffer, `${stem}.xlsx`);
  saveBlob(pdf, `${stem}.pdf`);
}

