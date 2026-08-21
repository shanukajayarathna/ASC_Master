export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
  createdAt: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  keyPrefix: string;
  roles: string[];
  createdAt: string;
  lastUsedAt: string | null;
}

/** Only returned once, at creation — rawKey is never retrievable again afterward. */
export interface ApiKeyCreated {
  summary: ApiKeySummary;
  rawKey: string;
}

export interface WebhookSummary {
  id: string;
  url: string;
  event: string;
  createdAt: string;
}

/** Only returned once, at creation — secret is never retrievable again afterward. */
export interface WebhookCreated {
  summary: WebhookSummary;
  secret: string;
}

/** A canonical business entity (a specific broker, buyer, garden, grade, ...) plus every raw
 *  spelling variant seen in broker files that should resolve to it. `type` is one of
 *  MASTER_DATA_ENTITY_TYPES — sent/received as a plain string, not a numeric enum. */
export interface MasterDataEntity {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string[];
  createdAt: string;
  updatedAt: string;
}

/** One raw value seen in source files that doesn't yet resolve to any canonical entity. */
export interface UnmappedMasterDataValue {
  value: string;
  count: number;
}

/** One "who did what" record from the audit trail. */
export interface AuditLogEntry {
  id: string;
  timestamp: string;
  userEmail: string | null;
  action: string;
  entityType: string | null;
  entityId: string | null;
  details: string | null;
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
  provider?: string | null;
}

export interface ChatResponse {
  conversationId: string;
  reply: string;
  provider: string;
}

export interface ProviderStatus {
  key: string;
  displayName: string;
  model: string | null;
  configured: boolean;
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

// ---- auction reports (Combined Report / Top Prices — cross-broker per-grade ranking) --------

export interface RankedLotRow {
  rank: number;
  broker: string;
  sellingMark: string;
  grade: string;
  subElevation: string | null;
  price: number;
  buyer: string | null;
  buyerName: string | null;
  isOurs: boolean;
  remark: string | null;
}

export interface GradeBlock {
  grade: string;
  rows: RankedLotRow[];
}

export interface ReportBlock {
  title: string;
  grades: GradeBlock[];
}

export interface AuctionReportSheet {
  title: string;
  includeElevation: boolean;
  blocks: ReportBlock[];
}

export interface AuctionReportStats {
  top: number;
  top4: number;
  absent: number;
  total: number;
  rows: number;
  outsold: number;
}

export interface AuctionReport {
  reportKey: string;
  title: string;
  sourceName: string;
  generatedAt: string;
  stats: AuctionReportStats;
  sheets: AuctionReportSheet[];
}

export interface CombinedReport {
  sourceName: string;
  generatedAt: string;
  reports: AuctionReport[];
}

// ---- worksheet (rough pre-auction scratchpad — never persisted server-side) -----------------

export interface WorksheetRow {
  lotNumber: string | null;
  broker: string | null;
  sellingMark: string | null;
  grade: string | null;
  bags: number | null;
  netWeight: number | null;
  totalWeight: number | null;
  /** Numeric figure used for Total Proceeds/totals math — the range's midpoint when
   *  valuationRangeText is set. */
  valuation: number | null;
  /** Set only when the valuation genuinely is a range (e.g. "1200-1300") — display/edit this
   *  instead of `valuation` whenever it's non-null, so a range doesn't silently collapse to
   *  one number. */
  valuationRangeText: string | null;
  remarks: string | null;
  /** Any column beyond the fixed set, keyed by its original header label (e.g. "Invoice No") —
   *  the Worksheet's "extra columns" concept, toggleable via the Columns menu. */
  extra: Record<string, string> | null;
}

export interface WorksheetLookupResult {
  rows: WorksheetRow[];
  totalMatches: number;
  truncated: boolean;
}

export interface WorksheetImportResult {
  fileName: string;
  rows: WorksheetRow[];
  skippedRows: number;
}

export interface WorksheetFactoryOption {
  code: string | null;
  name: string | null;
}

export interface WorksheetFacets {
  brokers: string[];
  factories: WorksheetFactoryOption[];
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
  /** Lots already settled (Status=Sold with a real price) straight from the sale file itself,
   *  independent of hasImport — accuracy metrics use these automatically with no upload needed. */
  fileEmbeddedMatched: number;
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

/** A cross-sale trend finding (Dimension "Grade" or "Buyer") — description is a
 *  ready-to-render, server-built sentence, never AI-generated. */
export interface PerformanceInsight {
  dimension: string;
  key: string;
  direction: string;
  magnitude: number;
  unit: string;
  salesSpan: number;
  description: string;
}

/** One in-app notification. actionUrl, when set, is a frontend route to navigate to on click. */
export interface AppNotification {
  id: string;
  type: string;
  priority: string;
  title: string;
  body: string | null;
  actionUrl: string | null;
  entityType: string | null;
  entityId: string | null;
  createdAt: string;
  readAt: string | null;
}

export interface Deadline {
  id: string;
  type: string;
  entityId: string;
  entityLabel: string | null;
  dueAt: string;
  responsibleRole: string;
  status: string;
  notifiedEscalationLevel: number;
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
  category: string;
  effectiveDate: string | null;
  expiryDate: string | null;
  supersedesDocumentId: string | null;
  /** Set when a newer upload named this document as the one it supersedes — computed
   *  server-side, not stored (see KnowledgeDocument.cs's doc comment). */
  supersededByDocumentId: string | null;
}

export interface DocumentSearchResult {
  documentFileName: string;
  documentId: string;
  chunkText: string;
  score: number;
  category: string;
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

// ---- MSL archive (master search over the 2013–present auction history) ----

export interface MslAuctionLot {
  saleYear: number;
  saleNo: number;
  saleDate: string;
  broker: string | null;
  brokerName: string | null;
  isPrivate: boolean;
  lotNo: string;
  invoice: string | null;
  factoryCode: string;
  sellingMark: string;
  grade: string;
  quantityKg: number;
  priceRs: number;
  sold: boolean;
  buyerCode: string | null;
  buyerName: string | null;
  estateName: string;
  mslCode: string | null;
  elevationCode: string | null;
  elevation: string | null;
  refuseTea: boolean;
}

export interface MslSearchAggregate {
  lots: number;
  soldLots: number;
  totalQtyKg: number;
  soldQtyKg: number;
  weightedAvgRs: number | null;
  minPriceRs: number | null;
  maxPriceRs: number | null;
}

export interface MslSearchResult {
  items: MslAuctionLot[];
  total: number;
  aggregate: MslSearchAggregate;
}

export interface MslAggregateRow {
  key: string;
  lots: number;
  soldLots: number;
  totalQtyKg: number;
  soldQtyKg: number;
  weightedAvgRs: number | null;
  minPriceRs: number | null;
  maxPriceRs: number | null;
}

export interface MslScanSummary {
  filesImported: number;
  rowsImported: number;
  filesUpToDate: number;
  filesRemoved: number;
  errors: string[];
  elapsed: string;
}

export interface MslYearStat {
  year: number;
  sales: number;
  lots: number;
}

export interface MslStatus {
  dataPath: string | null;
  totalLots: number;
  privateLots: number;
  trackedFiles: number;
  filesWithErrors: number;
  lastScanAt: string | null;
  lastScan: MslScanSummary | null;
  years: MslYearStat[];
  teaBoardMonths: number;
}

/** Shared filter set for /msl/search and /msl/aggregate. */
export interface MslFilters {
  q?: string;
  broker?: string;
  grade?: string;
  elevation?: string;
  buyer?: string;
  factory?: string;
  yearFrom?: number;
  yearTo?: number;
  saleNo?: number;
  sold?: boolean;
  isPrivate?: boolean;
}

// ---- MSL analytics rollups (Analysis page: pre/post auction dashboards) ----

export interface SaleStatRow {
  key: string;
  label: string | null;
  lots: number;
  soldLots: number;
  totalQtyKg: number;
  soldQtyKg: number;
  proceedsRs: number;
  avgPriceRs: number | null;
  minPriceRs: number | null;
  maxPriceRs: number | null;
}

export interface SaleSummary {
  year: number;
  saleNo: number;
  saleDate: string;
  lots: number;
  soldLots: number;
  totalQtyKg: number;
  soldQtyKg: number;
  proceedsRs: number;
  avgPriceRs: number | null;
}

export interface SaleAnalytics {
  year: number;
  saleNo: number;
  saleDate: string;
  isPrivateBucket: boolean;
  total: SaleStatRow;
  brokers: SaleStatRow[];
  elevations: SaleStatRow[];
  grades: SaleStatRow[];
  buyers: SaleStatRow[];
  marks: SaleStatRow[];
  priceRanges: SaleStatRow[];
  recentSales: SaleSummary[];
}

// ---- Weekly FACT Reports: "generate WES from database" ----

export interface WesFactoryRowApi {
  estate: string;
  code: string;
  weekQtyKg: number | null;
  weekAvgRs: number | null;
  monthQtyKg: number | null;
  monthAvgRs: number | null;
  yearQtyKg: number | null;
  yearAvgRs: number | null;
  weekRank: number | null;
  monthRank: number | null;
  yearRank: number | null;
}

export interface WesEquivalentApi {
  saleNo: number;
  saleDate: string;
  categories: Record<string, WesFactoryRowApi[]>;
  warnings: string[];
}

// ---- MSL cross-filtered analytics (Analysis page filter panel) ----

export interface MslAnalyticsFilter {
  years?: number[];
  saleNos?: number[];
  months?: number[];
  quarters?: number[];
  brokers?: string[];
  elevations?: string[];
  grades?: string[];
  categories?: string[];
  gradeTypes?: string[];
  teaTypes?: string[];
  manufactures?: string[];
  buyers?: string[];
  marks?: string[];
  factories?: string[];
  markTypes?: string[];
  groups?: string[];
  saleType?: "public" | "private" | null;
  soldStatus?: "sold" | "unsold" | null;
  refuseTea?: "only" | "exclude" | null;
  priceMin?: number | null;
  priceMax?: number | null;
  markSearch?: string | null;
  buyerSearch?: string | null;
  lotNos?: string[];
  invoices?: string[];
  bags?: number[];
  packings?: number[];
  districts?: string[];
  sharingStatus?: "asc" | "other" | null;
  organic?: "organic" | "non" | null;
}

export interface FilteredSectionRow {
  key: string;
  label: string | null;
  lots: number;
  soldLots: number;
  totalQtyKg: number;
  soldQtyKg: number;
  proceedsRs: number;
  avgPriceRs: number | null;
  maxPriceRs: number | null;
  askingAvgRs: number | null;
}

export interface OptionRow {
  key: string;
  label: string | null;
  lots: number;
}

export interface AvailableOptions {
  grades: OptionRow[];
  buyers: OptionRow[];
  marks: OptionRow[];
  factories: OptionRow[];
  groups: OptionRow[];
  lotNos: OptionRow[];
  invoices: OptionRow[];
  bags: OptionRow[];
  packings: OptionRow[];
  districts: OptionRow[];
  saleNos: OptionRow[];
  years: OptionRow[];
  months: OptionRow[];
  brokers: OptionRow[];
  elevations: OptionRow[];
  saleTypes: OptionRow[];
  soldStatuses: OptionRow[];
  refuseTea: OptionRow[];
}

export interface FilteredLotRow {
  saleYear: number;
  saleNo: number;
  saleDate: string;
  broker: string | null;
  isPrivate: boolean;
  lotNo: string;
  invoice: string | null;
  factoryCode: string;
  sellingMark: string;
  grade: string;
  category: string;
  quantityKg: number;
  priceRs: number;
  sold: boolean;
  buyer: string | null;
  bags: number | null;
  packingKg: number | null;
}

export interface FilteredLots {
  rows: FilteredLotRow[];
  page: number;
  hasMore: boolean;
}

export interface FilteredAnalytics {
  total: FilteredSectionRow;
  byBroker: FilteredSectionRow[];
  byElevation: FilteredSectionRow[];
  byGrade: FilteredSectionRow[];
  byCategory: FilteredSectionRow[];
  byBuyer: FilteredSectionRow[];
  byMark: FilteredSectionRow[];
  byFactory: FilteredSectionRow[];
  byPriceRange: FilteredSectionRow[];
  byPacking: FilteredSectionRow[];
  bySale: FilteredSectionRow[];
  /** Sold / Outsold / Unsold decomposition (OKLO status where Excel exists). */
  byOkloStatus: FilteredSectionRow[];
  available: AvailableOptions;
  elapsedMs: number;
}

export interface MslFilterOptions {
  years: number[];
  sales: SaleSummary[];
  brokers: string[];
  elevations: FilteredSectionRow[];
  grades: string[];
  gradeCategories: Record<string, string>;
  /** grade → [category, gradeType, teaType, manufacture] */
  gradeClasses: Record<string, string[]>;
  categories: string[];
  gradeTypes: string[];
  teaTypes: string[];
  manufactures: string[];
  markTypes: string[];
  groups: string[];
  buyers: string[];
  buyerNames: Record<string, string>;
}

/** One admin-uploadable file slot (a report template, the export letterhead logo) — see
 *  backend Modules/AdminAssets/AdminAssetCatalog.cs, the source of truth for the slot list. */
export interface AdminAssetStatus {
  id: string;
  group: string;
  label: string;
  description: string;
  fileName: string;
  hasOverride: boolean;
  sizeBytes: number | null;
  uploadedAtUtc: string | null;
  uploadedBy: string | null;
}
