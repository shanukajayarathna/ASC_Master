import type { ColumnMeta } from "@/types/api";
import { SALE_COLUMN_HEADER } from "@/lib/multiSale";

/**
 * A column that can go into an Excel export. `kind: "raw"` pulls a catalogue column by its
 * header; `kind: "field"` pulls one of the app's own values (valuation, classification,
 * the taster's text fields, or the sale name). `id` is a stable checkbox key for the picker.
 */
export interface ExportColumn {
  id: string;
  kind: "raw" | "field";
  key: string;
  label: string;
}

/** App-derived columns offered in every export, after the raw catalogue columns. */
export const VALUATION_EXPORT_COLUMNS: ExportColumn[] = [
  { id: "field:valuation", kind: "field", key: "valuation", label: "Valuation (Rs.)" },
  { id: "field:classification", kind: "field", key: "classification", label: "Classification" },
  { id: "field:standardData", kind: "field", key: "standardData", label: "Standard Data" },
  { id: "field:adjectiveData", kind: "field", key: "adjectiveData", label: "Adjective Data" },
  { id: "field:liquorRemarks", kind: "field", key: "liquorRemarks", label: "Taster's Remarks" },
  { id: "field:musterReport", kind: "field", key: "musterReport", label: "Muster Report" },
  { id: "field:brokerNotes", kind: "field", key: "brokerNotes", label: "Broker Notes" },
  { id: "field:privateNotes", kind: "field", key: "privateNotes", label: "Private Notes" },
];

/** The sale-name column — a real backend field, so it's offered once here rather than as the
 *  synthetic "Sale" raw column the on-screen grid uses. */
export const SALE_EXPORT_COLUMN: ExportColumn = { id: "field:sale", kind: "field", key: "sale", label: "Sale" };

/**
 * Everything the export column picker can offer for the given (combined) headers: the sale
 * column first when spanning sales, then each catalogue column, then the app's own fields.
 */
export function buildExportColumns(headers: string[], multiSale: boolean): ExportColumn[] {
  const raw: ExportColumn[] = headers
    .filter((h) => h !== SALE_COLUMN_HEADER)
    .map((h) => ({ id: `raw:${h}`, kind: "raw", key: h, label: h }));
  return [...(multiSale ? [SALE_EXPORT_COLUMN] : []), ...raw, ...VALUATION_EXPORT_COLUMNS];
}

/**
 * The columns pre-ticked when the picker opens: whatever raw columns are currently shown in
 * the grid (i.e. not hidden), plus valuation and classification, plus the sale column when
 * spanning sales. This is what makes "download only the selected columns" line up with the
 * grid's own show/hide state by default while still being adjustable per download.
 */
export function defaultExportColumnIds(headers: string[], hiddenColumns: Set<string>, multiSale: boolean): string[] {
  const ids: string[] = [];
  if (multiSale) ids.push(SALE_EXPORT_COLUMN.id);
  headers
    .filter((h) => h !== SALE_COLUMN_HEADER && !hiddenColumns.has(h))
    .forEach((h) => ids.push(`raw:${h}`));
  ids.push("field:valuation", "field:classification");
  return ids;
}

/** Headers a catalogue hides by default (defaultVisible = false) — lets the single-sale
 *  pages seed the export picker the same way the grid seeds its shown columns. */
export function hiddenFromMeta(columnMeta: Record<string, ColumnMeta>): Set<string> {
  return new Set(Object.entries(columnMeta).filter(([, m]) => !m.defaultVisible).map(([h]) => h));
}
