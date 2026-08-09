"use client";

import type { WorksheetRow } from "@/types/api";
import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

/** One exportable column — mirrors the original standalone Worksheet's getActiveColumns()
 *  shape (key/label/numeric), generalized to cover both the fixed default columns and any
 *  extra column the user has toggled on. Row is whatever WorksheetRow-shaped object the page
 *  is working with (its local Row type, which extends WorksheetRow with a client-side id). */
export interface WorksheetPdfColumn<TRow extends WorksheetRow = WorksheetRow> {
  label: string;
  numeric: boolean;
  getValue: (row: TRow) => string | number;
}

export const fmt2 = (n: number) => (Number.isFinite(n) ? n : 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function dateStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function safeFileName(value: string): string {
  return (
    String(value || "valuation-report")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "valuation-report"
  );
}

export function displayValuationForExport(row: WorksheetRow): string {
  return row.valuationRangeText || fmt2(row.valuation ?? 0);
}

function drawMetric(doc: jsPDF, x: number, y: number, width: number, label: string, value: string) {
  doc.setFillColor(232, 242, 255);
  doc.setDrawColor(58, 124, 210);
  doc.roundedRect(x, y, width, 30, 5, 5, "FD");
  doc.setFontSize(7);
  doc.setTextColor(58, 82, 110);
  doc.text(label.toUpperCase(), x + 10, y + 11);
  doc.setFontSize(13);
  doc.setTextColor(11, 37, 69);
  doc.text(value, x + 10, y + 24);
}

/** Loads a public image as a data URL + its natural pixel size, so the logo can be drawn at
 *  its real aspect ratio (matching window.ASC_LOGO / ASC_LOGO_W / ASC_LOGO_H in the original). */
export function loadImage(url: string): Promise<{ dataUrl: string; width: number; height: number } | null> {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(null);
        ctx.drawImage(img, 0, 0);
        resolve({ dataUrl: canvas.toDataURL("image/png"), width: img.naturalWidth, height: img.naturalHeight });
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

/**
 * Line-for-line port of the original standalone Worksheet tool's exportPdfRows (script.js),
 * using the same technology (jsPDF + jspdf-autotable) and the same layout: landscape A4, logo +
 * letterhead top-left, three metric boxes, a bordered/zebra-striped autoTable with a totals
 * footer row, saved as "{topic}-{yyyymmdd}.pdf".
 */
export async function exportWorksheetPdf<TRow extends WorksheetRow>(opts: {
  topic: string;
  columns: WorksheetPdfColumn<TRow>[];
  rows: TRow[];
  excludeUnvalued: boolean;
}): Promise<void> {
  const { topic, columns, rows, excludeUnvalued } = opts;

  const doc = new jsPDF({ orientation: "landscape", unit: "pt" });

  let textX = 40;
  const logo = await loadImage("/brand/tea-auction-logo.png");
  if (logo) {
    const ratio = logo.width > 0 && logo.height > 0 ? logo.width / logo.height : 1.5;
    const logoH = 42;
    const logoW = logoH * ratio;
    doc.addImage(logo.dataUrl, "PNG", 40, 12, logoW, logoH);
    textX = 40 + logoW + 16;
  }

  doc.setFontSize(16);
  doc.setFont("helvetica", "bold");
  doc.setTextColor(11, 37, 69);
  doc.text("ASIA SIYAKA COMMODITIES PLC", textX, 28);
  doc.setFont("helvetica", "normal");

  doc.setFontSize(12);
  doc.setTextColor(11, 37, 69);
  doc.text(topic, textX, 46);
  doc.setFontSize(9);
  doc.setTextColor(90, 100, 120);
  doc.text(`Generated ${new Date().toLocaleString()}  •  ${rows.length} lots`, textX, 60);

  const totalQty = rows.reduce((s, r) => s + (r.totalWeight ?? 0), 0);
  const totalValue = rows.reduce((s, r) => s + (r.valuation ?? 0) * (r.totalWeight ?? 0), 0);
  const avgRows = excludeUnvalued ? rows.filter((r) => (r.valuation ?? 0) > 0) : rows;
  const avgQty = avgRows.reduce((s, r) => s + (r.totalWeight ?? 0), 0);
  const avgValue = avgRows.reduce((s, r) => s + (r.valuation ?? 0) * (r.totalWeight ?? 0), 0);
  const avg = avgQty > 0 ? avgValue / avgQty : 0;
  const avgLabel = excludeUnvalued ? "Average price (valued lots)" : "Average price";

  drawMetric(doc, 40, 70, 190, "Total quantity (kg)", `${fmt2(totalQty)} kg`);
  drawMetric(doc, 242, 70, 190, avgLabel, fmt2(avg));
  drawMetric(doc, 444, 70, 190, "Total value", fmt2(totalValue));

  // Right-align numeric columns wherever they land; Valuation/Total Proceeds always follow the
  // active columns and are always right-aligned, Remarks (always last) stays wide enough to read.
  const columnStyles: Record<number, { halign?: "right"; cellWidth?: number }> = {};
  columns.forEach((c, idx) => {
    if (c.numeric) columnStyles[idx] = { halign: "right" };
  });
  const remarksIdx = columns.length - 1;
  columnStyles[remarksIdx] = { cellWidth: 130 };

  autoTable(doc, {
    startY: 112,
    head: [columns.map((c) => c.label)],
    body: rows.map((r) => columns.map((c) => c.getValue(r))),
    foot: [buildFootRow(columns, rows, totalQty, avg, totalValue)],
    showFoot: "lastPage",
    theme: "grid",
    styles: { fontSize: 8, cellPadding: 4, textColor: [26, 38, 52], lineColor: [122, 135, 152], lineWidth: 0.5 },
    headStyles: { fillColor: [11, 37, 69], textColor: 255, lineColor: [122, 135, 152], lineWidth: 0.5 },
    footStyles: { fillColor: [232, 242, 255], textColor: [11, 37, 69], fontStyle: "bold", lineColor: [11, 37, 69], lineWidth: 0.8 },
    alternateRowStyles: { fillColor: [242, 247, 253] },
    tableLineColor: [11, 37, 69],
    tableLineWidth: 1.2,
    columnStyles,
    margin: { left: 40, right: 40 },
    didParseCell(data) {
      if (data.section !== "body") {
        const style = columnStyles[data.column.index];
        if (style?.halign) data.cell.styles.halign = style.halign;
      }
    },
  });

  doc.save(`${safeFileName(topic)}-${dateStamp()}.pdf`);
}

function buildFootRow<TRow extends WorksheetRow>(
  columns: WorksheetPdfColumn<TRow>[],
  rows: TRow[],
  totalQty: number,
  avg: number,
  totalValue: number
): (string | number)[] {
  // "TOTAL — N lots" lands in the first column that doesn't already hold a total (Net/Total
  // Weight get their own sums); Valuation/Total Proceeds always get avg/totalValue.
  const totalNet = rows.reduce((s, r) => s + (r.netWeight ?? 0), 0);
  const label = `TOTAL — ${rows.length} lots`;
  let labelPlaced = false;
  const lead = columns.map((c) => {
    if (c.label === "Total Weight") return fmt2(totalQty);
    if (c.label === "Net Weight") return fmt2(totalNet);
    return "";
  });
  if (lead[0] === "") {
    lead[0] = label;
    labelPlaced = true;
  }
  const tail = [fmt2(avg), fmt2(totalValue), labelPlaced ? "" : label];
  return [...lead, ...tail];
}
