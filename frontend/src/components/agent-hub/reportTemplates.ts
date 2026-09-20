import { DEFAULT_STATE, type BuilderState } from "./reportBuilder";

export interface ReportTemplate {
  key: string;
  label: string;
  hint: string;
  state: BuilderState;
}

/** One-click starting points for the builder — each is just a set of builder choices, so the figures still come from the archive. */
export const REPORT_TEMPLATES: readonly ReportTemplate[] = [
  { key: "broker-price", label: "Broker average price", hint: "Average price by broker, last 12 sales", state: DEFAULT_STATE },
  { key: "broker-volume", label: "Broker volume", hint: "Quantity sold by broker, last 4 sales", state: { ...DEFAULT_STATE, metric: "sold_quantity_kg", period: "4" } },
  { key: "weekly-trend", label: "Weekly volume trend", hint: "Quantity sold per sale, last 12 sales", state: { ...DEFAULT_STATE, group: "sale", metric: "sold_quantity_kg", visual: "line" } },
  { key: "grade-mix", label: "Grade mix this year", hint: "Quantity sold by grade, this year", state: { ...DEFAULT_STATE, group: "grade", metric: "sold_quantity_kg", period: "year" } },
  { key: "latest-proceeds", label: "Latest sale proceeds", hint: "Proceeds by broker, latest sale, as a table", state: { ...DEFAULT_STATE, metric: "proceeds_rs", period: "latest", visual: "table" } },
];
