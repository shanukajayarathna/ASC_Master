import type { ColumnMeta, Lot } from "@/types/api";

export type ColumnFilterState =
  | { kind: "categorical"; values: string[] }
  | { kind: "numeric"; min: string; max: string }
  | { kind: "text"; value: string };

export type TicketStatus = "empty" | "partial" | "full";

export function getTicketStatus(lot: Lot): TicketStatus {
  const v = lot.valuation;
  if (!v) return "empty";
  const hasValue = v.valuationSingle !== null || v.valuationFrom !== null;
  const hasText = !!(v.standardData || v.adjectiveData || v.liquorRemarks || v.musterReport);
  if (!hasValue && !hasText) return "empty";
  if (hasValue && v.standardData && v.liquorRemarks) return "full";
  return "partial";
}

export function emptyColumnFilter(meta: ColumnMeta | undefined): ColumnFilterState {
  if (meta?.categorical) return { kind: "categorical", values: [] };
  if (meta?.numeric) return { kind: "numeric", min: "", max: "" };
  return { kind: "text", value: "" };
}

export function isColumnFilterActive(f: ColumnFilterState | undefined): boolean {
  if (!f) return false;
  if (f.kind === "categorical") return f.values.length > 0;
  if (f.kind === "numeric") return f.min !== "" || f.max !== "";
  return f.value.trim() !== "";
}

export interface FilterOptions {
  search: string;
  columnFilters: Record<string, ColumnFilterState>;
  status: TicketStatus | "";
  classification: string;
  /** Sale year (typed lot field, not a raw column) — "" means all years. */
  year?: string;
}

export function filterLots(lots: Lot[], opts: FilterOptions): Lot[] {
  const search = opts.search.trim().toLowerCase();

  return lots.filter((lot) => {
    if (search) {
      const hay = Object.values(lot.rawData).join(" ").toLowerCase();
      if (!hay.includes(search)) return false;
    }

    for (const [header, f] of Object.entries(opts.columnFilters)) {
      if (!isColumnFilterActive(f)) continue;
      const raw = lot.rawData[header] ?? "";
      if (f.kind === "categorical") {
        if (!f.values.includes(raw)) return false;
      } else if (f.kind === "numeric") {
        const num = parseFloat(raw.replace(/,/g, ""));
        if (f.min !== "" && !(num >= parseFloat(f.min))) return false;
        if (f.max !== "" && !(num <= parseFloat(f.max))) return false;
      } else {
        if (!raw.toLowerCase().includes(f.value.trim().toLowerCase())) return false;
      }
    }

    if (opts.status && getTicketStatus(lot) !== opts.status) return false;
    if (opts.classification && (lot.valuation?.classification ?? "Unclassified") !== opts.classification) return false;
    if (opts.year && (lot.saleYear ?? "") !== opts.year) return false;

    return true;
  });
}
