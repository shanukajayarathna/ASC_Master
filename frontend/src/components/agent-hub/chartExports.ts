import type { ChartSpec } from "@/components/assistant/ChartBlock";
import type { CustomPreview, DeckReport } from "@/types/api";
import { SOURCE_LINE } from "./reportBuilder";

/** The chart's own numbers as a preview dataset, so the same Excel / snapshot / deck code that serves the report canvas serves any chart in the chat. */
export function specToPreview(spec: ChartSpec): CustomPreview {
  return {
    title: spec.title,
    scope: spec.subtitle ?? "",
    metric: spec.series[0]?.name ?? spec.title,
    unit: spec.unit,
    additive: false,
    split: spec.series.length > 1,
    categoryAxis: spec.categoryAxis ?? "",
    categories: spec.categories,
    series: spec.series,
    markdownTable: specMarkdown(spec),
  };
}

const cell = (v: number | null | undefined) => (v == null ? "—" : v.toLocaleString("en-US", { maximumFractionDigits: 2 }));

/** A markdown table of the chart's data (header row, separator, one row per category). */
export function specMarkdown(spec: ChartSpec): string {
  const head = [spec.categoryAxis || "Category", ...spec.series.map((s) => s.name)];
  const rows = spec.categories.map((c, i) => [c, ...spec.series.map((s) => cell(s.values[i]))]);
  return [head, head.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

/** The markdown a saved snapshot of this chart stores: title, scope, the chart, its table, the source. */
export function specSnapshot(spec: ChartSpec): string {
  const parts = [`## ${spec.title}`];
  if (spec.subtitle) parts.push(spec.subtitle);
  parts.push("", "```asc-chart", JSON.stringify(spec), "```", "", specMarkdown(spec), "", `_${SOURCE_LINE}_`);
  return parts.join("\n");
}

/** A chart as a deck entry: a line stays a line, everything else is drawn as bars (the deck supports bar, line and table). */
export function specToDeckReport(spec: ChartSpec): DeckReport {
  return {
    title: spec.title,
    scope: spec.subtitle ?? "",
    unit: spec.unit,
    categoryAxis: spec.categoryAxis ?? "Category",
    visual: spec.type === "line" ? "line" : "bar",
    categories: spec.categories,
    series: spec.series,
  };
}
