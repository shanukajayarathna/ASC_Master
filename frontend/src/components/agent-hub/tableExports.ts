import { api } from "@/lib/api";
import { SOURCE_LINE, safeFileName } from "./reportBuilder";

/** A markdown table found in an assistant answer: the header row and the body rows, cell text as written. */
export interface MarkdownTable {
  header: string[];
  rows: string[][];
}

const splitRow = (line: string) =>
  line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim().replace(/\*\*/g, ""));
const isSeparator = (line: string) => /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)+\|?\s*$/.test(line);

/** The first markdown table in <paramref name="text"/> (header, separator, ≥1 body row), or null. */
export function parseMarkdownTable(text: string): MarkdownTable | null {
  const lines = text.split(/\r?\n/);
  for (let i = 0; i + 2 < lines.length + 1; i++) {
    if (!lines[i]?.includes("|") || !lines[i + 1] || !isSeparator(lines[i + 1])) continue;
    const header = splitRow(lines[i]);
    const rows: string[][] = [];
    for (let j = i + 2; j < lines.length && lines[j].includes("|"); j++) rows.push(splitRow(lines[j]));
    if (rows.length > 0) return { header, rows };
  }
  return null;
}

/** "1,234.5" / "Rs 1,234" / "12%" → number; anything else stays text. */
function asNumber(cell: string): number | string {
  const t = cell.replace(/,/g, "").replace(/^Rs\.?\s*/i, "").replace(/%$/, "").trim();
  return t !== "" && /^-?\d+(\.\d+)?$/.test(t) ? Number(t) : cell;
}

export async function downloadTableXlsx(table: MarkdownTable, title: string) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow([title]).font = { bold: true, size: 14 };
  ws.addRow([]);
  ws.addRow(table.header).font = { bold: true };
  for (const row of table.rows) ws.addRow(row.map(asNumber));
  ws.addRow([]);
  ws.addRow([SOURCE_LINE]);
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 30 : 18));
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(title)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Saves the table as a custom report and opens its printable page (the browser's Save as PDF). */
export async function openTablePdf(table: MarkdownTable, title: string) {
  const md = [table.header, table.header.map(() => "---"), ...table.rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
  const report = await api.saveCustomReport(title, [`## ${title}`, "", md, "", `_${SOURCE_LINE}_`].join("\n"));
  window.open(`/print/custom-report?id=${report.id}`, "_blank", "noopener");
}
