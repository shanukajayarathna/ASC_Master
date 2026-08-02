export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: string;
}

export interface AuthResponse {
  token: string;
  user: AuthUser;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ChatResponse {
  conversationId: string;
  reply: string;
}

export interface ReportKpi {
  label: string;
  value: number | null;
  format: string;
}

export interface ReportGroupRow {
  label: string;
  count: number;
  averageValue: number | null;
  percent: number | null;
}

export interface ReportSection {
  title: string;
  kpis: ReportKpi[] | null;
  groupUnitLabel: string | null;
  groups: ReportGroupRow[] | null;
}

export interface Report {
  type: string;
  title: string;
  subtitle: string;
  sourceName: string;
  generatedAt: string;
  sections: ReportSection[];
}

export interface SavedReport {
  id: string;
  type: string;
  title: string;
  catalogueId: string | null;
  source: string | null;
  createdAt: string;
}

export interface FilterPreset {
  id: string;
  catalogueId: string;
  name: string;
  filtersJson: string;
  createdAt: string;
}

export interface OverviewStats {
  mean: number | null;
  median: number | null;
  mode: number | null;
  stdDev: number | null;
  variance: number | null;
  q1: number | null;
  q3: number | null;
  spread: number | null;
}

export interface TopBottomLot {
  lotId: string;
  lotNumber: string | null;
  broker: string | null;
  grade: string | null;
  effectiveValue: number | null;
}

export interface DataQuality {
  missingValuations: number;
  incompleteRecords: number;
  duplicateLots: number;
  outliers: number;
}

export interface ImportActualsResult {
  fileName: string;
  matched: number;
  unmatched: number;
  ambiguous: number;
  importedAt: string;
}

export interface ImportStatus {
  hasImport: boolean;
  lastImportedAt: string | null;
  matched: number;
  unmatched: number;
  ambiguous: number;
}

export interface AccuracyOverview {
  lotsCompared: number;
  accuracy: number | null;
  mape: number | null;
  rmse: number | null;
  avgError: number | null;
  totalGain: number | null;
  totalLoss: number | null;
}

export interface AccuracyBucket {
  label: string;
  count: number;
  mape: number;
  bias: number;
}

export interface MarketInsight {
  dimension: string;
  key: string;
  count: number;
  avgDiff: number;
  direction: "overvalued" | "undervalued";
  magnitude: number;
}

export interface BrokerStats {
  name: string;
  lots: number;
  valued: number;
  share: number;
  avg: number | null;
  max: number | null;
  min: number | null;
  topGrade: string;
  topCategory: string;
  netWeight: number;
}

export interface KnowledgeDocument {
  id: string;
  fileName: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
}

export interface DocumentSearchResult {
  documentFileName: string;
  documentId: string;
  chunkText: string;
  score: number;
}

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

export type ClassificationValue = "Unclassified" | "SelectBest" | "Best" | "BelowBest" | "Poor";

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
  /** The UpdatedAt this form was opened with (null if never valued) — echoed straight from
   *  Valuation.updatedAt, unparsed, so the server can detect a save based on stale data. */
  expectedUpdatedAt: string | null;
}

/** One classification tier's track record for a grade in a previous sale. */
export interface GradeTierStats {
  classification: ClassificationValue;
  count: number;
  percent: number;
  min: number;
  max: number;
  avg: number;
}

/** How one grade was classified in the most recent previous sale that offered it. */
export interface GradeStats {
  saleName: string;
  total: number;
  tiers: GradeTierStats[];
}

export interface PreviousGradeStats {
  grades: Record<string, GradeStats>;
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
