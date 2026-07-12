export interface ColumnMeta {
  numeric: boolean;
  categorical: boolean;
  options: string[];
  defaultVisible: boolean;
}

export interface CatalogueSummary {
  id: string;
  sourceName: string;
  rowCount: number;
  columnCount: number;
  importedAt: string;
}

export interface CatalogueDetail {
  id: string;
  sourceName: string;
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  rowCount: number;
  importedAt: string;
}

export type ClassificationValue = "Unclassified" | "Best" | "BelowBest" | "Poor";

export interface Valuation {
  valuationFrom: number | null;
  valuationTo: number | null;
  valuationSingle: number | null;
  classification: ClassificationValue;
  standardData: string | null;
  adjectiveData: string | null;
  liquorRemarks: string | null;
  musterReport: string | null;
  brokerNotes: string | null;
  privateNotes: string | null;
  updatedAt: string | null;
}

export interface ValuationUpdate {
  valuationFrom: number | null;
  valuationTo: number | null;
  valuationSingle: number | null;
  classification: ClassificationValue | null;
  standardData: string | null;
  adjectiveData: string | null;
  liquorRemarks: string | null;
  musterReport: string | null;
  brokerNotes: string | null;
  privateNotes: string | null;
}

export interface Lot {
  id: string;
  rowKey: string;
  lotNumber: string | null;
  broker: string | null;
  grade: string | null;
  garden: string | null;
  category: string | null;
  elevation: string | null;
  region: string | null;
  warehouse: string | null;
  mark: string | null;
  saleNo: string | null;
  saleYear: string | null;
  invoiceNo: string | null;
  netWeight: number | null;
  grossWeight: number | null;
  rawData: Record<string, string>;
  valuation: Valuation | null;
}

export interface PagedLots {
  rows: Lot[];
  total: number;
  page: number;
  pageSize: number;
}

export interface DashboardStats {
  total: number;
  completed: number;
  pending: number;
  todayCount: number;
  avgValuation: number | null;
  maxValuation: number | null;
  minValuation: number | null;
  avgRangeWidth: number | null;
  mostActiveBroker: string | null;
  mostCommonGrade: string | null;
  mostCommonCategory: string | null;
  mostCommonElevation: string | null;
  totalNetWeight: number | null;
  totalGrossWeight: number | null;
  avgNetWeight: number | null;
  avgGrossWeight: number | null;
}
