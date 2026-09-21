import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { BROKERS } from "@/lib/brokers";
import type { ChatScope, CustomPreview, CustomPreviewRequest, DeckReport } from "@/types/api";

export const GROUPS = [
  { key: "broker", label: "Broker" },
  { key: "grade", label: "Grade" },
  { key: "sale", label: "Sale" },
  { key: "elevation", label: "Origin" },
] as const;
export const METRICS = [
  { key: "avg_price_rs", label: "Avg price" },
  { key: "sold_quantity_kg", label: "Qty sold" },
  { key: "proceeds_rs", label: "Proceeds" },
  { key: "sold_lots", label: "Lots sold" },
  { key: "share_of_own_volume_pct", label: "% of own volume" },
] as const;
export const PERIODS = [
  { key: "4", label: "Last 4" },
  { key: "12", label: "Last 12" },
  { key: "year", label: "Year" },
  { key: "latest", label: "Latest sale" },
  { key: "scope", label: "Chosen scope" },
] as const;
export const VISUALS = [
  { key: "bar", label: "Bar" },
  { key: "line", label: "Line" },
  { key: "table", label: "Table" },
] as const;

export type GroupKey = (typeof GROUPS)[number]["key"];
export type MetricKey = (typeof METRICS)[number]["key"];
export type PeriodKey = (typeof PERIODS)[number]["key"];
export type VisualKey = (typeof VISUALS)[number]["key"];

export interface BuilderState {
  group: GroupKey;
  metric: MetricKey;
  period: PeriodKey;
  /** Broker short codes (ASC, FW, …); empty = all brokers. */
  brokers: string[];
  /** Grade filter (BOPF, OP1, …) — set by the voice builder; empty = all grades. */
  grades: string[];
  /** "Off Grade" and/or "Main Grade"; empty = both. */
  gradeTypes: string[];
  /** The scope chosen in the assistant (a sale, range or years). The "Chosen scope" period uses it. */
  range: ChatScope | null;
  visual: VisualKey;
}

export const DEFAULT_STATE: BuilderState = { group: "broker", metric: "avg_price_rs", period: "12", brokers: [], grades: [], gradeTypes: [], range: null, visual: "bar" };

/** The eight brokers with their permanent colours (light-theme value; the chart itself themes them). */
export const BROKER_CHIPS = Object.values(BROKERS).map((b) => ({ code: b.code, name: b.name, color: b.color }));

export const label = <T extends { key: string; label: string }>(list: readonly T[], key: string) => list.find((x) => x.key === key)?.label ?? key;

/** Maps the builder onto the archive query. "Last N" adds the last N sales up into one total; "Year" is the current year. */
export function toRequest(state: BuilderState, now = new Date()): CustomPreviewRequest {
  const req: CustomPreviewRequest = { groupBy: state.group, metric: state.metric, topN: 8 };
  if (state.period === "4") req.lastNSales = 4;
  else if (state.period === "12") req.lastNSales = 12;
  else if (state.period === "year") req.years = [now.getFullYear()];
  else if (state.period === "scope" && state.range) {
    req.fromYear = state.range.fromYear;
    req.fromSale = state.range.fromSale;
    req.toYear = state.range.toYear;
    req.toSale = state.range.toSale;
  }
  if (state.brokers.length > 0) req.brokers = state.brokers;
  if (state.grades.length > 0) req.grades = state.grades;
  if (state.gradeTypes.length > 0) req.gradeTypes = state.gradeTypes;
  // A per-sale breakdown wants every sale shown, not just the biggest few.
  if (state.group === "sale") req.topN = 12;
  return req;
}

/** The chart for a visual choice, or null for "table". A line needs two points, so a single one falls back to bars. */
export function chartSpecFrom(preview: CustomPreview, visual: VisualKey): ChartSpec | null {
  if (visual === "table" || preview.categories.length === 0) return null;
  const multi = preview.series.length > 1;
  const type = visual === "line" && preview.categories.length >= 2 ? "line" : !multi && preview.categories.length > 8 ? "horizontal_bar" : "bar";
  return {
    type,
    title: preview.title,
    subtitle: preview.scope,
    unit: preview.unit,
    categoryAxis: preview.categoryAxis,
    categories: preview.categories,
    series: preview.series,
  };
}

const num = (v: number, unit: string) => {
  const n = v.toLocaleString(undefined, { maximumFractionDigits: unit === "Rs/kg" ? 2 : 0 });
  return unit === "Rs" || unit === "Rs/kg" ? `Rs ${n}` : unit === "kg" ? `${n} kg` : n;
};

/** The summary block under the chart: computed here from the dataset's own numbers, never written by a model. */
export function summarize(preview: CustomPreview): string[] {
  const first = preview.series[0];
  if (!first) return [];
  const pairs = preview.categories
    .map((c, i) => [c, first.values[i]] as const)
    .filter((p): p is readonly [string, number] => p[1] != null && p[0] !== "Other");
  if (pairs.length === 0) return [];
  const sorted = [...pairs].sort((a, b) => b[1] - a[1]);
  const lines = [`Highest: ${sorted[0][0]} — ${num(sorted[0][1], preview.unit)}`];
  if (sorted.length > 1) lines.push(`Lowest: ${sorted[sorted.length - 1][0]} — ${num(sorted[sorted.length - 1][1], preview.unit)}`);
  if (preview.additive) lines.push(`Total shown: ${num(pairs.reduce((s, p) => s + p[1], 0), preview.unit)}`);
  return lines;
}

export const SOURCE_LINE = "Source: ASC Intelligence Hub — MSL auction archive.";

/** The markdown a snapshot stores (rendered by the Saved Reports page and the print route): title, scope, chart, table, source. */
export function snapshotContent(preview: CustomPreview, spec: ChartSpec | null): string {
  const parts = [`## ${preview.title}`, preview.scope, ""];
  if (spec) parts.push("```asc-chart", JSON.stringify(spec), "```", "");
  parts.push(preview.markdownTable, "", `_${SOURCE_LINE}_`);
  return parts.join("\n");
}

/** Rows for a spreadsheet: a header row (category axis then each series) and one row per category. */
export function tableRows(preview: CustomPreview): (string | number | null)[][] {
  return [
    [preview.categoryAxis, ...preview.series.map((s) => s.name)],
    ...preview.categories.map((c, i) => [c, ...preview.series.map((s) => s.values[i] ?? null)]),
  ];
}

export const safeFileName = (title: string) => title.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "report";

/** Builds and downloads an .xlsx of the preview (title, scope, the table, source). ExcelJS loads on first use. */
export async function downloadXlsx(preview: CustomPreview) {
  const { default: ExcelJS } = await import("exceljs");
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Report");
  ws.addRow([preview.title]).font = { bold: true, size: 14 };
  ws.addRow([preview.scope]);
  ws.addRow([`Unit: ${preview.unit}`]);
  ws.addRow([]);
  const header = ws.addRow(tableRows(preview)[0]);
  header.font = { bold: true };
  for (const row of tableRows(preview).slice(1)) ws.addRow(row);
  ws.addRow([]);
  ws.addRow([SOURCE_LINE]);
  ws.columns.forEach((c, i) => (c.width = i === 0 ? 28 : 18));
  const buffer = await wb.xlsx.writeBuffer();
  const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = `${safeFileName(preview.title)}.xlsx`;
  a.click();
  URL.revokeObjectURL(url);
}

export const MAX_DECK_SLIDES = 12;
export const MAX_DECK_REPORTS = 5;

/** The preview as a deck entry (what the backend turns into a native chart slide and a table slide). */
export function toDeckReport(preview: CustomPreview, visual: VisualKey): DeckReport {
  return {
    title: preview.title,
    scope: preview.scope,
    unit: preview.unit,
    categoryAxis: preview.categoryAxis,
    visual,
    categories: preview.categories,
    series: preview.series,
  };
}

export const deckReportKey = (r: DeckReport) => JSON.stringify([r.title, r.scope, r.visual, r.categories, r.series]);

/** Slides a deck holds: a title slide, then a chart slide (unless it is a table) and a table slide per report — capped at 12. */
export function deckSlideCount(reports: readonly DeckReport[]): number {
  return Math.min(MAX_DECK_SLIDES, 1 + reports.reduce((n, r) => n + (r.visual === "table" ? 1 : 2), 0));
}
