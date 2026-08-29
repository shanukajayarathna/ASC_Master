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

// ---- Mark Intelligence (Plantation → Factory → Mark → Broker) ---------------------------

export interface Plantation {
  id: string;
  name: string;
  isActive: boolean;
  factoryCount: number;
}

export interface FactoryRecord {
  id: string;
  plantationId: string | null;
  code: string;
  name: string;
  isActive: boolean;
  markCount: number;
}

export interface MarkBrokerEra {
  brokers: string[];
  isShared: boolean;
  startYear: number;
  startSaleNo: number;
  endYear: number | null;
  endSaleNo: number | null;
}

export interface MarkRecord {
  id: string;
  factoryId: string;
  factoryCode: string;
  factoryName: string;
  plantationId: string | null;
  plantationName: string | null;
  code: string;
  name: string;
  status: "Active" | "Discontinued";
  currentBrokers: string[];
  isCurrentlyShared: boolean;
  timeline: MarkBrokerEra[];
}

export interface MiningRunResult {
  factoriesSeen: number;
  marksSeen: number;
  newMarksCreated: number;
  periodFactsWritten: number;
  erasComputed: number;
  marksWithMultipleEras: number;
  marksEverShared: number;
  marksThatChangedFactory: number;
  runAt: string;
}

/** Delete endpoints return 204 when hard-deleted, or 200 with this when deactivated
 *  instead because the entity has real history under it. */
export interface DeactivatedInsteadOfDeleted {
  deactivated: true;
  reason: string;
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
  /** True only for a report whose actual output was persisted server-side (today, just the
   *  automated Weekly FACT job) rather than regenerated on demand — show a Download action
   *  instead of the usual Reopen-and-regenerate one. */
  downloadable: boolean;
  /** Placeholder message on the monthly Combined Report job's output; null otherwise. */
  notes: string | null;
}

// ---- Automated Reports (Admin Panel) — see backend/Modules/ScheduledReports ----

export type ScheduledReportJobTriggerType = "AfterSaleClose" | "Schedule";

export interface ScheduledReportJob {
  key: string;
  displayName: string;
  triggerType: ScheduledReportJobTriggerType;
  cronExpression: string | null;
  cadence: "Weekly" | "Monthly";
  enabled: boolean;
  lastRunAt: string | null;
  lastStatus: "NeverRun" | "Succeeded" | "Waiting" | "Failed";
  lastMessage: string | null;
  lastDurationMs: number;
  consecutiveFailures: number;
}

export interface ScheduledReportOutput {
  id: string;
  title: string;
  createdAt: string;
  notes: string | null;
  downloadable: boolean;
}

export interface StagedCbac {
  saleYear: number;
  saleNo: number;
  stagedAt: string;
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

// ---- Category Analysis (Price & Classification — Sale x Broker) — see backend/Modules/CategoryReports ----

export interface CategoryOption {
  category: string;
  lotCount: number;
}

export interface SaleRef {
  saleNo: number;
  saleYear: number;
  label: string;
}

export interface BrokerDistributionRow {
  broker: string;
  lots: number;
  sharePct: number;
  distinctMarks: number;
  qtyOfferedKg: number;
  qtySoldKg: number;
  proceedsRs: number;
  avgPriceRsKg: number;
}

export interface CategoryStatusRow {
  broker: string;
  sold: number;
  outsold: number;
  unsold: number;
  total: number;
  soldPct: number;
  outsoldPct: number;
  unsoldPct: number;
}

export interface TierRow {
  tier: string;
  lots: number;
  sharePct: number;
  qtyKg: number;
  avgPriceRsKg: number;
  minPriceRsKg: number;
  maxPriceRsKg: number;
}

export interface TierBrokerRow {
  tier: string;
  broker: string;
  lots: number;
  qtyKg: number;
  avgPriceRsKg: number;
}

export interface SaleTrendRow {
  saleNo: number;
  saleYear: number;
  lotsOffered: number;
  sold: number;
  outsold: number;
  unsold: number;
  soldPct: number;
  qtyOfferedKg: number;
  qtySoldKg: number;
  avgPriceRsKg: number;
  proceedsRs: number;
}

/** The flagship row: one (sale, broker) — achieved price plus the full Select Best/Best/Below
 *  Best/Poor split for that broker's sold lots in that one sale. */
export interface SaleBrokerRow {
  saleNo: number;
  saleYear: number;
  broker: string;
  lots: number;
  sold: number;
  soldPct: number;
  avgPriceRsKg: number;
  selectBestLots: number;
  selectBestSharePct: number;
  selectBestAvgPriceRsKg: number;
  bestLots: number;
  bestSharePct: number;
  bestAvgPriceRsKg: number;
  belowBestLots: number;
  belowBestSharePct: number;
  belowBestAvgPriceRsKg: number;
  poorLots: number;
  poorSharePct: number;
  poorAvgPriceRsKg: number;
}

export interface CategoryAnalysisSummary {
  totalLots: number;
  sold: number;
  outsold: number;
  unsold: number;
  brokerCount: number;
  distinctMarks: number;
}

export interface CategoryAnalysis {
  category: string;
  sales: SaleRef[];
  summary: CategoryAnalysisSummary;
  brokerDistribution: BrokerDistributionRow[];
  status: CategoryStatusRow[];
  tiers: TierRow[];
  tierByBroker: TierBrokerRow[];
  trend: SaleTrendRow[];
  saleBroker: SaleBrokerRow[];
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

/** A year with gaps in its public-auction sale numbers — e.g. 27 missing between 26 and 28. */
export interface MslGap {
  year: number;
  maxSaleNo: number;
  missingSaleNos: number[];
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
  gaps: MslGap[];
}

export interface MslBatchFileResult {
  fileName: string;
  sourceZip: string | null;
  kind: "auction" | "private" | null;
  broker: string | null;
  year: number | null;
  saleNo: number | null;
  rows: number;
  error: string | null;
}

export interface MslBatchUploadResult {
  files: MslBatchFileResult[];
  scan: MslScanSummary;
}

export interface MslStagedFile {
  stagingId: string;
  fileName: string;
  sourceZip: string | null;
  kind: "auction" | "private" | null;
  broker: string | null;
  year: number | null;
  saleNo: number | null;
  rows: number;
  error: string | null;
  willReplace: boolean;
  replaceDetail: string | null;
  requiresConfirmation: boolean;
  confirmToken: string | null;
}

export interface MslStageBatchResult {
  batchId: string;
  files: MslStagedFile[];
  expiresAtUtc: string;
}

export interface MslTrackedFile {
  relativePath: string;
  kind: "auction" | "private" | "teaboard" | "other";
  year: number | null;
  saleNo: number | null;
  length: number;
  lastWriteUtc: string;
  importedAt: string;
  rowCount: number;
  error: string | null;
}

export type MarketPulseCategory = "TeaMarket" | "ShippingLogistics" | "CurrencyTrade" | "WeatherCrop" | "GlobalEconomy";
export type MarketPulseItemStatus = "Pending" | "Scored" | "Failed";

/** One news item — RawSummary is verbatim from its RSS source; every Ai* field is null
 *  until (if ever) scoring succeeds, so "not yet scored" is always distinguishable from a
 *  real score of 0. See MarketPulseController's doc comment for the "grounded, not
 *  generative" + "one number, one source" design principles this shape encodes. */
export interface MarketPulseItem {
  id: string;
  sourceUrl: string;
  sourceName: string;
  title: string;
  publishedAt: string | null;
  rawSummary: string;
  aiRelevanceScore: number | null;
  aiCategory: MarketPulseCategory | null;
  aiWhyItMatters: string | null;
  status: MarketPulseItemStatus;
  ingestedAt: string;
  scoredAt: string | null;
}

export interface MarketPulsePagedResult {
  items: MarketPulseItem[];
  total: number;
  page: number;
  pageSize: number;
}

export interface MarketPulseFilters {
  category?: MarketPulseCategory;
  from?: string;
  to?: string;
  minRelevance?: number;
  page?: number;
  pageSize?: number;
}

export interface MarketPulseSource {
  id: string;
  name: string;
  feedUrl: string;
  category: MarketPulseCategory;
  enabled: boolean;
  addedBy: string | null;
  addedAt: string;
  lastFetchedAt: string | null;
  lastFetchSucceeded: boolean | null;
  lastFetchError: string | null;
  lastFetchNewItems: number;
}

export interface MarketPulseIngestionSummary {
  sourcesChecked: number;
  sourcesFailed: number;
  newItems: number;
  scored: number;
  stillUnscored: number;
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
  askingRs: number | null;
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

/** Public landing page (/home) ticker projection — headline/category/date only. See
 *  MarketPulseController.PublicTicker. */
export interface PublicMarketPulseItem {
  title: string;
  aiCategory: MarketPulseCategory | null;
  publishedAt: string | null;
}

// ---- Landing Page CMS (/home + Admin Panel "Landing Page" section) ----------------------

export interface LandingHero {
  headline: string;
  subhead: string;
  ctaPrimaryLabel: string;
  ctaSecondaryLabel: string;
}

export interface LandingCompanyStats {
  foundedYear: number;
  yearsOperating: number;
  ranking: string;
  marketShareLabel: string;
  employeeCount: number;
  warehouseCount: number;
  vision: string;
  mission: string;
}

export interface LandingPlatformStat {
  label: string;
  value: string;
  isLive: boolean;
  liveSourceKey: string | null;
}

export interface LandingIntelligenceItem {
  title: string;
  description: string;
  iconKey: string;
  order: number;
}

export interface LandingTestimonial {
  id: string;
  name: string;
  role: string;
  quote: string;
  avatarUrl: string;
  order: number;
  isPublished: boolean;
}

export interface LandingHeritage {
  pullQuote: string;
  bodyCopy: string;
  imageUrl: string;
}

export interface LandingPageContent {
  hero: LandingHero;
  companyStats: LandingCompanyStats;
  platformStats: LandingPlatformStat[];
  fiveIntelligences: LandingIntelligenceItem[];
  testimonials: LandingTestimonial[];
  heritage: LandingHeritage;
  updatedAt: string;
  updatedBy: string | null;
}

// ---- Request Access (public /request-access page + Admin Panel review list) -------------

export type AccessRequestStatus = "Pending" | "Reviewed";

export interface AccessRequest {
  id: string;
  name: string;
  email: string;
  company: string;
  message: string;
  status: AccessRequestStatus;
  createdAt: string;
}
