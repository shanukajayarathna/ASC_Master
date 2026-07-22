import { sortForDisplay } from "@/lib/ourBroker";
import type { CatalogueDetail, ColumnMeta, Lot } from "@/types/api";

/**
 * Combining several sales into one working set (Catalogue Manager's multi-sale selection):
 * the lots of every selected sale are pooled, tagged with the sale they came from, and the
 * catalogues' differing column layouts are unioned into one header list. A synthetic "Sale"
 * column names each lot's sale so the pooled grid stays legible — it rides in each lot's
 * rawData, which means the existing search / column-filter / export machinery treats it like
 * any other column with no special-casing.
 */
export const SALE_COLUMN_HEADER = "Sale";

export interface CombinedCatalogue {
  /** Pooled lots, each sale's block kept together (our own lots first within each). */
  lots: Lot[];
  /** Union of every selected sale's headers; "Sale" is prepended when more than one sale. */
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  /** lot id → the catalogue (sale) it belongs to, for building export refs and work handoffs. */
  catalogueIdByLot: Map<string, string>;
  /** Sale names in selection order (what the "Sale" column / filter offers). */
  saleNames: string[];
}

export interface SaleEntry {
  id: string;
  sourceName: string;
  detail: CatalogueDetail;
  lots: Lot[];
}

const emptyCombined: CombinedCatalogue = {
  lots: [],
  headers: [],
  columnMeta: {},
  catalogueIdByLot: new Map(),
  saleNames: [],
};

/** Merge two sales' meta for a shared header: numeric only if both are, categorical if
 *  either is, options and default-visibility unioned. */
function mergeMeta(a: ColumnMeta, b: ColumnMeta): ColumnMeta {
  return {
    numeric: a.numeric && b.numeric,
    categorical: a.categorical || b.categorical,
    options: Array.from(new Set([...a.options, ...b.options])),
    defaultVisible: a.defaultVisible || b.defaultVisible,
  };
}

export function combineSales(entries: SaleEntry[], multiSale: boolean): CombinedCatalogue {
  if (entries.length === 0) return emptyCombined;

  const catalogueIdByLot = new Map<string, string>();
  const saleNames = Array.from(new Set(entries.map((e) => e.sourceName)));

  const lots: Lot[] = [];
  for (const entry of entries) {
    const tagged = entry.lots.map((lot) => {
      catalogueIdByLot.set(lot.id, entry.id);
      // Only pool-tag when actually spanning sales — a single sale stays byte-for-byte
      // what it was, so nothing downstream changes for the common case.
      return multiSale
        ? { ...lot, rawData: { ...lot.rawData, [SALE_COLUMN_HEADER]: entry.sourceName } }
        : lot;
    });
    lots.push(...sortForDisplay(tagged));
  }

  const headerOrder: string[] = [];
  const seen = new Set<string>();
  const columnMeta: Record<string, ColumnMeta> = {};
  for (const entry of entries) {
    for (const h of entry.detail.headers) {
      if (!seen.has(h)) {
        seen.add(h);
        headerOrder.push(h);
      }
      const m = entry.detail.columnMeta[h];
      if (m) columnMeta[h] = columnMeta[h] ? mergeMeta(columnMeta[h], m) : { ...m };
    }
  }

  const headers = multiSale ? [SALE_COLUMN_HEADER, ...headerOrder] : headerOrder;
  if (multiSale) {
    columnMeta[SALE_COLUMN_HEADER] = {
      numeric: false,
      categorical: true,
      options: saleNames,
      defaultVisible: true,
    };
  }

  return { lots, headers, columnMeta, catalogueIdByLot, saleNames };
}
