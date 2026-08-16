import type {
  AccuracyBucket,
  AccuracyOverview,
  ApiKeyCreated,
  ApiKeySummary,
  AppNotification,
  AuctionReport,
  AuditLogEntry,
  AuthResponse,
  AuthUser,
  BrokerStats,
  CatalogueDetail,
  CatalogueSummary,
  ChatMessage,
  ChatResponse,
  CombinedReport,
  Conversation,
  DashboardStats,
  DataQuality,
  Deadline,
  DocumentSearchResult,
  FilterPreset,
  ImportActualsResult,
  ImportStatus,
  KnowledgeDocument,
  Lot,
  FilteredAnalytics,
  FilteredLots,
  MarketInsight,
  MasterDataEntity,
  MslAggregateRow,
  MslAnalyticsFilter,
  MslFilterOptions,
  MslFilters,
  MslScanSummary,
  MslSearchResult,
  MslStatus,
  OverviewStats,
  PagedLots,
  PerformanceInsight,
  PreviousGradeStats,
  SaleAnalytics,
  SaleSummary,
  WesEquivalentApi,
  ProviderStatus,
  Report,
  ReportGroupRow,
  SavedReport,
  TopBottomLot,
  UnmappedMasterDataValue,
  ValuationUpdate,
  WebhookCreated,
  WebhookSummary,
  WorksheetFacets,
  WorksheetImportResult,
  WorksheetLookupResult,
  WorksheetRow,
} from "@/types/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058";

// Set by AuthContext on login/logout/hydrate. Module-level rather than passed per-call
// since `request()` isn't a component — every existing call site stays untouched, and the
// header gets added in exactly the one place all of them already funnel through.
let authToken: string | null = null;
export function setAuthToken(token: string | null) {
  authToken = token;
}

/** What media a lot currently has: a photo, and which remark fields carry a voice note. */
export interface LotMedia {
  photo: boolean;
  voice: string[];
}

/** A failed request, with the HTTP status and (when the body was JSON) its parsed body —
 *  callers that care about a specific status (e.g. 409 on a stale valuation save) read
 *  `status`/`body` instead of pattern-matching the message string. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public body?: unknown
  ) {
    super(message);
    this.name = "ApiError";
  }
}

// ---- in-flight request tracking ------------------------------------------------------
// NavigationLoader keeps its route-transition overlay up until the destination page's data
// has actually arrived — not just until the route commits, which is all `navigatesuccess`
// can signal (every page here is a client component that fetches after mount; see docs/28).
// Every page's primary data load funnels through `request()`, so a counter in this one
// place is the "is the new page still loading?" signal, with zero changes at call sites.
// The direct-`fetch` helpers further down (photo/voice blobs, file uploads, binary exports)
// are deliberately NOT counted: they run on user actions inside an already-rendered page,
// never as part of a page's first load — and a multi-minute upload must never pin a
// navigation overlay over the whole app. Same for `lib/weather.ts`: best-effort external
// decoration that shouldn't hold the door.
let inFlightRequests = 0;
const inFlightListeners = new Set<() => void>();

/** How many `request()` calls are currently awaiting a response. */
export function getInFlightRequestCount(): number {
  return inFlightRequests;
}

/** Notifies on every in-flight count change; returns the unsubscribe function. */
export function subscribeInFlightRequests(listener: () => void): () => void {
  inFlightListeners.add(listener);
  return () => {
    inFlightListeners.delete(listener);
  };
}

function trackInFlight(delta: 1 | -1) {
  inFlightRequests += delta;
  for (const listener of inFlightListeners) listener();
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  trackInFlight(1);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
        ...(init?.headers ?? {}),
      },
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let body: unknown;
      try {
        body = text ? JSON.parse(text) : undefined;
      } catch {
        // Not JSON — plain-text error bodies (e.g. BadRequest("...")) are common here too.
      }
      const message =
        (body as { message?: string } | undefined)?.message || text || `Request failed: ${res.status} ${res.statusText}`;
      throw new ApiError(message, res.status, body);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  } finally {
    trackInFlight(-1);
  }
}

export const api = {
  // ---- auth -----------------------------------------------------------------------
  login: (email: string, password: string) =>
    request<AuthResponse>("/api/v1/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  /** Only succeeds while no account exists yet (bootstrap), or when called by an
   *  already-authenticated Admin (the token must already be set via setAuthToken). */
  register: (email: string, password: string, displayName: string) =>
    request<AuthResponse>("/api/v1/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password, displayName }),
    }),

  me: () => request<AuthUser>("/api/v1/auth/me"),

  listUsers: () => request<AuthUser[]>("/api/v1/auth/users"),

  setUserRole: (id: string, roles: string[]) =>
    request<AuthUser>(`/api/v1/auth/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ roles }) }),

  deleteUser: (id: string) => request<void>(`/api/v1/auth/users/${id}`, { method: "DELETE" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // ---- api keys (machine credentials for external callers, e.g. n8n) -----------------

  listApiKeys: () => request<ApiKeySummary[]>("/api/v1/api-keys"),

  createApiKey: (name: string, roles: string[]) =>
    request<ApiKeyCreated>("/api/v1/api-keys", { method: "POST", body: JSON.stringify({ name, roles }) }),

  deleteApiKey: (id: string) => request<void>(`/api/v1/api-keys/${id}`, { method: "DELETE" }),

  // ---- webhooks (outbound event notifications, e.g. to n8n) --------------------------

  listWebhookEvents: () => request<string[]>("/api/v1/webhooks/events"),

  listWebhooks: () => request<WebhookSummary[]>("/api/v1/webhooks"),

  createWebhook: (url: string, event: string) =>
    request<WebhookCreated>("/api/v1/webhooks", { method: "POST", body: JSON.stringify({ url, event }) }),

  deleteWebhook: (id: string) => request<void>(`/api/v1/webhooks/${id}`, { method: "DELETE" }),

  // ---- master data (canonical broker/buyer/garden/grade/... names + spelling aliases) ----
  // Resolution itself happens server-side at read time (Analytics/Market/Reports/Assistant);
  // this is only the admin CRUD + the "what still needs mapping" discovery scan.

  listMasterData: (type?: string) =>
    request<MasterDataEntity[]>(`/api/v1/master-data${type ? `?type=${encodeURIComponent(type)}` : ""}`),

  createMasterData: (type: string, canonicalName: string, aliases: string[]) =>
    request<MasterDataEntity>("/api/v1/master-data", { method: "POST", body: JSON.stringify({ type, canonicalName, aliases }) }),

  updateMasterData: (id: string, type: string, canonicalName: string, aliases: string[]) =>
    request<MasterDataEntity>(`/api/v1/master-data/${id}`, { method: "PUT", body: JSON.stringify({ type, canonicalName, aliases }) }),

  deleteMasterData: (id: string) => request<void>(`/api/v1/master-data/${id}`, { method: "DELETE" }),

  getUnmappedMasterData: (type: string) =>
    request<UnmappedMasterDataValue[]>(`/api/v1/master-data/unmapped?type=${encodeURIComponent(type)}`),

  // ---- audit log (who did what, for admin-mutating actions) --------------------------

  listAuditLog: (skip: number, take: number) =>
    request<AuditLogEntry[]>(`/api/v1/audit-log?skip=${skip}&take=${take}`),

  // ---- knowledge base ---------------------------------------------------------------
  // Unlike every call below this point, these endpoints actually require login — so the
  // multipart upload (which bypasses `request()`'s auto-attached header, same as
  // importCatalogue below) has to attach Authorization itself.

  uploadDocument: async (
    file: File,
    category: string,
    effectiveDate?: string,
    expiryDate?: string,
    supersedesDocumentId?: string
  ): Promise<KnowledgeDocument> => {
    const form = new FormData();
    form.append("file", file);
    form.append("category", category);
    if (effectiveDate) form.append("effectiveDate", effectiveDate);
    if (expiryDate) form.append("expiryDate", expiryDate);
    if (supersedesDocumentId) form.append("supersedesDocumentId", supersedesDocumentId);
    const res = await fetch(`${API_BASE}/api/v1/documents`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Upload failed");
    }
    return res.json();
  },

  listDocuments: () => request<KnowledgeDocument[]>("/api/v1/documents"),

  deleteDocument: (id: string) => request<void>(`/api/v1/documents/${id}`, { method: "DELETE" }),

  searchDocuments: (q: string) => request<DocumentSearchResult[]>(`/api/v1/documents/search?q=${encodeURIComponent(q)}`),

  syncPlatformDocs: () =>
    request<{ added: number; updated: number; unchanged: number; failed: string[] }>(
      "/api/v1/documents/sync-platform-docs",
      { method: "POST" }
    ),

  // ---- AI assistant ------------------------------------------------------------------

  sendChatMessage: (message: string, conversationId?: string, provider?: string, catalogueId?: string) =>
    request<ChatResponse>("/api/v1/assistant/chat", {
      method: "POST",
      // catalogueId = the Topbar's active sale, so the assistant knows what "the current
      // sale" means without a tool round-trip.
      body: JSON.stringify({ conversationId: conversationId ?? null, message, provider: provider ?? null, catalogueId: catalogueId ?? null }),
    }),

  listConversations: () => request<Conversation[]>("/api/v1/assistant/conversations"),

  getConversationMessages: (id: string) => request<ChatMessage[]>(`/api/v1/assistant/conversations/${id}/messages`),

  deleteConversation: (id: string) => request<void>(`/api/v1/assistant/conversations/${id}`, { method: "DELETE" }),

  getProviderStatuses: () => request<ProviderStatus[]>("/api/v1/assistant/providers"),

  // ---- reports ------------------------------------------------------------------------

  generateReport: (catalogueId: string, type: string) => request<Report>(`/api/v1/reports/${catalogueId}/${type}`),

  exportReportExcel: async (catalogueId: string, type: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/v1/reports/${catalogueId}/${type}/excel`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  exportReportPptx: async (catalogueId: string, type: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/v1/reports/${catalogueId}/${type}/pptx`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  saveReport: (type: string, title: string, catalogueId: string, source: string) =>
    request<SavedReport>("/api/v1/reports/saved", {
      method: "POST",
      body: JSON.stringify({ type, title, catalogueId, source }),
    }),

  listSavedReports: () => request<SavedReport[]>("/api/v1/reports/saved"),

  deleteSavedReport: (id: string) => request<void>(`/api/v1/reports/saved/${id}`, { method: "DELETE" }),

  // ---- auction reports (Combined Report / Top Prices) --------------------------------

  getCombinedReport: (catalogueId: string) => request<CombinedReport>(`/api/v1/auction-reports/${catalogueId}/combined`),

  getAuctionReport: (catalogueId: string, reportKey: string) =>
    request<AuctionReport>(`/api/v1/auction-reports/${catalogueId}/${reportKey}`),

  // ---- worksheet (rough pre-auction scratchpad) ---------------------------------------

  getWorksheetLots: (catalogueId: string, broker: string, factories: string[]) => {
    const qs = new URLSearchParams();
    if (broker) qs.set("broker", broker);
    factories.filter(Boolean).forEach((f) => qs.append("factory", f));
    return request<WorksheetLookupResult>(`/api/v1/worksheet/lots?catalogueId=${catalogueId}&${qs.toString()}`);
  },

  getWorksheetFacets: (catalogueId: string) => request<WorksheetFacets>(`/api/v1/worksheet/facets?catalogueId=${catalogueId}`),

  importWorksheetFile: async (file: File): Promise<WorksheetImportResult> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/v1/worksheet/import`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Import failed");
    }
    return res.json();
  },

  exportWorksheetExcel: async (
    title: string,
    saleLabel: string | null,
    rows: WorksheetRow[],
    excludeUnvalued: boolean,
    extraColumnKeys: string[],
    // Defaults match the Worksheet tool's own wording; the Asking Price tool (which shares this
    // same export endpoint/builder) passes "Asking Price"/"Total Value"/"Asking Price Report".
    labels?: { valuationLabel?: string; proceedsLabel?: string; sheetName?: string }
  ): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/v1/worksheet/export/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({
        title,
        saleLabel,
        rows,
        excludeUnvalued,
        extraColumnKeys,
        valuationLabel: labels?.valuationLabel,
        proceedsLabel: labels?.proceedsLabel,
        sheetName: labels?.sheetName,
      }),
    });
    if (!res.ok) throw new Error("Export failed");
    return res.blob();
  },

  downloadWorksheetTemplate: async (priceLabel: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/v1/worksheet/template?priceLabel=${encodeURIComponent(priceLabel)}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Could not download the template");
    return res.blob();
  },

  // ---- saved filters --------------------------------------------------------------------

  saveFilterPreset: (catalogueId: string, name: string, filtersJson: string) =>
    request<FilterPreset>("/api/v1/filter-presets", {
      method: "POST",
      body: JSON.stringify({ catalogueId, name, filtersJson }),
    }),

  listFilterPresets: () => request<FilterPreset[]>("/api/v1/filter-presets"),

  getFilterPreset: (id: string) => request<FilterPreset>(`/api/v1/filter-presets/${id}`),

  deleteFilterPreset: (id: string) => request<void>(`/api/v1/filter-presets/${id}`, { method: "DELETE" }),

  // ---- analytics ----------------------------------------------------------------------

  getOverviewStats: (catalogueId: string) => request<OverviewStats>(`/api/v1/analytics/${catalogueId}/overview`),

  getBreakdown: (catalogueId: string, column: string) =>
    request<ReportGroupRow[]>(`/api/v1/analytics/${catalogueId}/breakdown/${column}`),

  getDistribution: (catalogueId: string) => request<ReportGroupRow[]>(`/api/v1/analytics/${catalogueId}/distribution`),

  getTopBottomLots: (catalogueId: string, mode: "top" | "bottom", n: number) =>
    request<TopBottomLot[]>(`/api/v1/analytics/${catalogueId}/top-bottom?mode=${mode}&n=${n}`),

  getDataQuality: (catalogueId: string) => request<DataQuality>(`/api/v1/analytics/${catalogueId}/quality`),

  getBrokerStats: (catalogueId: string) => request<BrokerStats[]>(`/api/v1/analytics/${catalogueId}/brokers`),

  // ---- market intelligence -------------------------------------------------------------

  importActuals: async (catalogueId: string, file: File): Promise<ImportActualsResult> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/v1/market/${catalogueId}/import`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Import failed");
    }
    return res.json();
  },

  getImportStatus: (catalogueId: string) => request<ImportStatus>(`/api/v1/market/${catalogueId}/import-status`),

  getAccuracyOverview: (catalogueId: string) => request<AccuracyOverview>(`/api/v1/market/${catalogueId}/overview`),

  getAccuracyBreakdown: (catalogueId: string, column: string) =>
    request<AccuracyBucket[]>(`/api/v1/market/${catalogueId}/breakdown/${column}`),

  getMarketInsights: (catalogueId: string) => request<MarketInsight[]>(`/api/v1/market/${catalogueId}/insights`),

  // ---- performance (cross-sale grade/buyer trends) -----------------------------------

  getPerformanceInsights: () => request<PerformanceInsight[]>("/api/v1/performance/insights"),

  // ---- deadlines (catalogue closure reminders/escalation) ----------------------------

  getUpcomingDeadlines: () => request<Deadline[]>("/api/v1/deadlines/upcoming"),

  // ---- notifications -------------------------------------------------------------------

  listNotifications: (unreadOnly = false, take = 20) =>
    request<AppNotification[]>(`/api/v1/notifications?unreadOnly=${unreadOnly}&take=${take}`),

  getUnreadNotificationCount: () => request<number>("/api/v1/notifications/unread-count"),

  markNotificationRead: (id: string) => request<void>(`/api/v1/notifications/${id}/read`, { method: "POST" }),

  markAllNotificationsRead: () => request<void>("/api/v1/notifications/read-all", { method: "POST" }),

  listCatalogues: () => request<CatalogueSummary[]>("/api/catalogues"),

  getCatalogue: (id: string) => request<CatalogueDetail>(`/api/catalogues/${id}`),

  deleteCatalogue: (id: string) =>
    request<void>(`/api/catalogues/${id}`, { method: "DELETE" }),

  importCatalogue: async (file: File): Promise<CatalogueDetail> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/catalogues/import`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Import failed");
    }
    return res.json();
  },

  getLots: (
    catalogueId: string,
    params: {
      search?: string;
      status?: string;
      broker?: string;
      grade?: string;
      category?: string;
      garden?: string;
      sortKey?: string;
      sortDir?: number;
      page?: number;
      pageSize?: number;
    } = {}
  ) => {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    const query = qs.toString();
    return request<PagedLots>(
      `/api/catalogues/${catalogueId}/lots${query ? `?${query}` : ""}`
    );
  },

  getDashboardStats: (catalogueId: string) =>
    request<DashboardStats>(`/api/catalogues/${catalogueId}/dashboard`),

  getPreviousGradeStats: (catalogueId: string) =>
    request<PreviousGradeStats>(`/api/catalogues/${catalogueId}/previous-grade-stats`),

  updateValuation: (lotId: string, dto: ValuationUpdate) =>
    request<Lot>(`/api/lots/${lotId}/valuation`, {
      method: "PATCH",
      body: JSON.stringify(dto),
    }),

  // `skipped` counts lots left alone because they have no valuation — a classification
  // grades a value, so an unvalued lot can't take one.
  bulkClassify: (lotIds: string[], classification: string) =>
    request<{ updated: number; skipped: number }>("/api/lots/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ lotIds, classification }),
    }),

  bulkClearNotes: (lotIds: string[]) =>
    request<{ updated: number }>("/api/lots/bulk-clear-notes", {
      method: "POST",
      body: JSON.stringify({ lotIds }),
    }),

  // ---- per-lot media (photo + voice notes) --------------------------------------
  // Binaries are stored locally on the API (data/media) behind a DB-swappable seam; the
  // browser sends the captured/recorded blob as a raw PUT body.

  getLotMedia: (lotId: string) => request<LotMedia>(`/api/lots/${lotId}/media`),

  /** Load the stored photo as a blob (same-origin object URL) so it can be displayed/re-cropped
   *  without cross-origin taint. Media endpoints require login, so — unlike a bare <img src>,
   *  which can't carry a bearer token — every read goes through this authenticated fetch. */
  fetchPhotoBlob: async (lotId: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/photo`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Could not load the photo.");
    return res.blob();
  },

  uploadPhoto: async (lotId: string, blob: Blob): Promise<LotMedia> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/photo`, {
      method: "PUT",
      headers: {
        "Content-Type": blob.type || "image/jpeg",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: blob,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Photo upload failed.");
    return res.json();
  },

  deletePhoto: async (lotId: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/photo`, {
      method: "DELETE",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Could not delete the photo.");
  },

  /** Load a stored voice note as a blob so it plays from a same-origin object URL — more
   *  reliable across browsers than a cross-origin <audio src> with range requests, and (like
   *  fetchPhotoBlob) the only way to carry auth to this now-login-required endpoint. */
  fetchVoiceBlob: async (lotId: string, field: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/voice/${field}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Could not load the voice note.");
    return res.blob();
  },

  uploadVoice: async (lotId: string, field: string, blob: Blob): Promise<LotMedia> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/voice/${field}`, {
      method: "PUT",
      headers: {
        "Content-Type": blob.type || "audio/webm",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: blob,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Voice upload failed.");
    return res.json();
  },

  deleteVoice: async (lotId: string, field: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/voice/${field}`, {
      method: "DELETE",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Could not delete the voice note.");
  },

  // ---- MSL analytics (Analysis page) ----

  mslAnalyticsSales: (year?: number) =>
    request<SaleSummary[]>(`/api/v1/msl/analytics/sales${year ? `?year=${year}` : ""}`),

  /** Weekly FACT Reports' "generate from database" option — the WES master workbook's
   *  factory rows, reproduced from already-imported auctionLots. 404s when the sale hasn't
   *  been imported yet (the page falls back to asking for a manual upload). */
  mslWeeklyReportWes: (year: number, saleNo: number) =>
    request<WesEquivalentApi>(`/api/v1/msl/weekly-report/wes?year=${year}&saleNo=${saleNo}`),

  mslSaleAnalytics: (year: number, saleNo: number) =>
    request<SaleAnalytics>(`/api/v1/msl/analytics/${year}/${saleNo}`),

  mslFilterOptions: () => request<MslFilterOptions>("/api/v1/msl/analytics/filter-options"),

  mslFilteredAnalytics: (filter: MslAnalyticsFilter) =>
    request<FilteredAnalytics>("/api/v1/msl/analytics/filtered", {
      method: "POST",
      body: JSON.stringify(filter),
    }),

  /** Turns a chat-rendered table into a real .xlsx download (server-built via NPOI). */
  downloadTableAsExcel: async (headers: string[], rows: string[][], fileName: string, title?: string) => {
    const res = await fetch(`${API_BASE}/api/v1/msl/analytics/export/table`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ fileName, title: title ?? null, headers, rows }),
    });
    if (!res.ok) throw new ApiError(await res.text().catch(() => "Export failed"), res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName.endsWith(".xlsx") ? fileName : `${fileName}.xlsx`;
    a.click();
    URL.revokeObjectURL(url);
  },

  /** Downloads an authenticated file (e.g. an agent-generated Excel) via blob + save. */
  downloadAuthedFile: async (path: string, filename: string) => {
    const res = await fetch(`${API_BASE}${path}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new ApiError(await res.text().catch(() => "Download failed"), res.status);
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },

  mslFilteredLots: (filter: MslAnalyticsFilter, page = 1, pageSize = 200, search?: string) =>
    request<FilteredLots>("/api/v1/msl/analytics/filtered/lots", {
      method: "POST",
      body: JSON.stringify({ filter, page, pageSize, search: search || null }),
    }),

  /** Chat routed to a specific agent (e.g. "analytics" for the Analysis page's dock).
   *  `provider` should be a configured provider key — see getProviderStatuses(). */
  sendAgentChatMessage: (agent: string, message: string, conversationId?: string, provider?: string) =>
    request<ChatResponse>("/api/v1/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: conversationId ?? null, message, agent, provider: provider ?? null }),
    }),

  // ---- MSL archive (master search) ----

  mslStatus: () => request<MslStatus>("/api/v1/msl/status"),

  mslRescan: (force = false) =>
    request<MslScanSummary>(`/api/v1/msl/rescan?force=${force}`, { method: "POST" }),

  mslSearch: (filters: MslFilters, page = 1, pageSize = 50) => {
    const qs = new URLSearchParams();
    Object.entries({ ...filters, page, pageSize }).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return request<MslSearchResult>(`/api/v1/msl/search?${qs.toString()}`);
  },

  mslAggregate: (groupBy: string, filters: MslFilters, limit = 100) => {
    const qs = new URLSearchParams({ groupBy, limit: String(limit) });
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return request<MslAggregateRow[]>(`/api/v1/msl/aggregate?${qs.toString()}`);
  },

  /**
   * Excel export. Lots are (catalogue, lot) pairs so one workbook can span several sales
   * at once; `columns` is the ordered set of columns to include (raw catalogue columns or
   * the app's own valuation fields), so the file carries only what was asked for.
   */
  exportExcel: async (
    lots: { catalogueId: string; lotId: string }[],
    columns: { kind: string; key: string; label: string }[]
  ): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/export/excel`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: JSON.stringify({ lots, columns }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Export failed");
    }
    return res.blob();
  },
};
