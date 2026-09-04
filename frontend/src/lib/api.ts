import type {
  AccessRequest,
  AccuracyBucket,
  AccuracyOverview,
  AdminAssetStatus,
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
  CategoryAnalysis,
  CategoryOption,
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
  LandingPageContent,
  Lot,
  FilteredAnalytics,
  FilteredLots,
  MarketBulletin,
  MarketInsight,
  MarketPulseCategory,
  MarketPulseFilters,
  MarketPulseIngestionSummary,
  MarketPulsePagedResult,
  MarketPulseSource,
  MasterDataEntity,
  DeactivatedInsteadOfDeleted,
  FactoryRecord,
  MarkRecord,
  MiningRunResult,
  MarkActivitySnapshot,
  MarkActivityChange,
  ActivitySummary,
  UnresolvedMarkSighting,
  Plantation,
  MslAnalyticsFilter,
  MslBatchUploadResult,
  MslFilterOptions,
  MslScanSummary,
  MslStageBatchResult,
  MslStatus,
  MslTrackedFile,
  OverviewStats,
  PagedLots,
  PerformanceInsight,
  PreviousGradeStats,
  PublicMarketPulseItem,
  SaleAnalytics,
  SaleSummary,
  WesEquivalentApi,
  ProviderStatus,
  Report,
  ReportGroupRow,
  SavedReport,
  ScheduledReportJob,
  ScheduledReportOutput,
  SharedMarkCatalogueGenerateResponse,
  StagedCbac,
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

/** The localStorage key AuthContext persists the bearer token under — owned here (not
 *  AuthContext) since `request()` needs it too, to clear a token the server has just told us
 *  is no longer valid (see the 401 handling below). */
export const AUTH_TOKEN_STORAGE_KEY = "asc_auth_token";

// AuthContext registers itself here on mount so a 401 anywhere in the app — not just the one
// request that happened to hit it — immediately clears the session everywhere: `user` drops
// to null, and every route guard that already watches for that (AppLayout, the auth pages'
// own force-logout-on-public-page hook) reacts on its own. Without this, a token that expires
// or gets revoked mid-session would sit invisible until whichever page's error handling
// happened to notice, and most just render a generic "request failed" message instead of
// recognizing it as a dead session.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
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
      // A 401 while we believed we had a valid token means the server disagrees — expired,
      // revoked, or a role change that invalidated it. Only fires when a token was actually
      // sent: an anonymous request 401ing (e.g. an admin-only endpoint called by a signed-out
      // visitor) is normal and not a session that needs tearing down.
      if (res.status === 401 && authToken) {
        window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
        authToken = null;
        onUnauthorized?.();
      }
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

  /** Admin-only: change another user's email, display name and/or reset their password
   *  directly (no current-password check — see AuthController.UpdateCredentials). Any field
   *  may be omitted; pass only what's changing. displayName is what the dashboard greeting
   *  and Topbar show. */
  updateUserCredentials: (id: string, fields: { email?: string; newPassword?: string; displayName?: string }) =>
    request<AuthUser>(`/api/v1/auth/users/${id}/credentials`, { method: "PATCH", body: JSON.stringify(fields) }),

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

  // ---- mark intelligence (Plantation → Factory → Mark, mined broker history) ---------

  listPlantations: () => request<Plantation[]>("/api/v1/mark-intelligence/plantations"),
  createPlantation: (name: string) =>
    request<Plantation>("/api/v1/mark-intelligence/plantations", { method: "POST", body: JSON.stringify({ name }) }),
  updatePlantation: (id: string, name: string, isActive: boolean) =>
    request<void>(`/api/v1/mark-intelligence/plantations/${id}`, { method: "PUT", body: JSON.stringify({ name, isActive }) }),
  deletePlantation: (id: string) =>
    request<DeactivatedInsteadOfDeleted | undefined>(`/api/v1/mark-intelligence/plantations/${id}`, { method: "DELETE" }),

  listFactoriesForPlantation: (plantationId: string) =>
    request<FactoryRecord[]>(`/api/v1/mark-intelligence/plantations/${plantationId}/factories`),
  listUnassignedFactories: () => request<FactoryRecord[]>("/api/v1/mark-intelligence/factories/unassigned"),
  createFactory: (plantationId: string | null, code: string, name: string) =>
    request<FactoryRecord>("/api/v1/mark-intelligence/factories", {
      method: "POST",
      body: JSON.stringify({ plantationId, code, name }),
    }),
  updateFactory: (id: string, plantationId: string | null, code: string, name: string, isActive: boolean) =>
    request<void>(`/api/v1/mark-intelligence/factories/${id}`, {
      method: "PUT",
      body: JSON.stringify({ plantationId, code, name, isActive }),
    }),
  deleteFactory: (id: string) =>
    request<DeactivatedInsteadOfDeleted | undefined>(`/api/v1/mark-intelligence/factories/${id}`, { method: "DELETE" }),

  listMarksForFactory: (factoryId: string) => request<MarkRecord[]>(`/api/v1/mark-intelligence/factories/${factoryId}/marks`),
  getMark: (id: string) => request<MarkRecord>(`/api/v1/mark-intelligence/marks/${id}`),
  searchMarkIntelligence: (q: string) => request<MarkRecord[]>(`/api/v1/mark-intelligence/search?q=${encodeURIComponent(q)}`),
  createMark: (factoryId: string, name: string, code: string) =>
    request<MarkRecord>("/api/v1/mark-intelligence/marks", { method: "POST", body: JSON.stringify({ factoryId, name, code }) }),
  updateMark: (id: string, name: string, code: string, status: string) =>
    request<void>(`/api/v1/mark-intelligence/marks/${id}`, { method: "PUT", body: JSON.stringify({ name, code, status }) }),
  deleteMark: (id: string) =>
    request<DeactivatedInsteadOfDeleted | undefined>(`/api/v1/mark-intelligence/marks/${id}`, { method: "DELETE" }),

  runMarkIntelligenceMining: () => request<MiningRunResult>("/api/v1/mark-intelligence/mine", { method: "POST" }),

  // ---- mark intelligence: ASC activity (3mo/6mo reconciliation, shared-mark detection) -

  getMarkActivity: (markId: string) => request<MarkActivitySnapshot[]>(`/api/v1/mark-intelligence/marks/${markId}/activity`),
  listActivityChanges: (params: { window?: "3mo" | "6mo"; kind?: "AtRisk" | "Lost" | "NewlyIncoming" | "NewlyShared" } = {}) => {
    const qs = new URLSearchParams();
    if (params.window) qs.set("window", params.window);
    if (params.kind) qs.set("kind", params.kind);
    const suffix = qs.toString();
    return request<MarkActivityChange[]>(`/api/v1/mark-intelligence/activity/changes${suffix ? `?${suffix}` : ""}`);
  },
  getActivitySummary: () => request<ActivitySummary>("/api/v1/mark-intelligence/activity/summary"),
  listUnresolvedMarks: () => request<UnresolvedMarkSighting[]>("/api/v1/mark-intelligence/activity/unresolved-marks"),

  // ---- audit log (who did what, for admin-mutating actions) --------------------------

  listAuditLog: (skip: number, take: number) =>
    request<AuditLogEntry[]>(`/api/v1/audit-log?skip=${skip}&take=${take}`),

  // ---- admin assets (report templates + branding logo, admin-uploadable overrides of --
  // ---- what otherwise ships baked into the frontend build / data/branding) -----------

  listAdminAssets: () => request<AdminAssetStatus[]>("/api/v1/admin/assets"),

  /** Slot ids that currently have an admin override — see weeklyFactReport.ts's
   *  loadTemplate, which calls this once per report run instead of probing every slot. */
  listAssetOverrideIds: () => request<string[]>("/api/v1/assets/overrides"),

  uploadAdminAsset: async (slotId: string, file: File): Promise<AdminAssetStatus> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/v1/admin/assets/${slotId}`, {
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

  revertAdminAsset: (slotId: string) => request<void>(`/api/v1/admin/assets/${slotId}`, { method: "DELETE" }),

  /** Fetches the current override for a slot as raw bytes, or null when the slot has no
   *  override (the caller should fall back to its own bundled default in that case). */
  fetchAssetOverride: async (slotId: string): Promise<ArrayBuffer | null> => {
    const res = await fetch(`${API_BASE}/api/v1/assets/${slotId}`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`Could not load asset override '${slotId}' (HTTP ${res.status}).`);
    return res.arrayBuffer();
  },

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

  downloadSavedReport: async (id: string): Promise<{ blob: Blob; fileName: string | null }> => {
    const res = await fetch(`${API_BASE}/api/v1/reports/saved/${id}/download`, {
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
    });
    if (!res.ok) throw new Error("Download failed");
    // The backend names the file (e.g. "factory-sale-summary_sale34_2026.xlsx") via
    // Content-Disposition — different job types produce different formats (.zip, .xlsx),
    // so the caller must not assume an extension.
    const disposition = res.headers.get("Content-Disposition");
    const fileName = disposition?.match(/filename="([^"]+)"/)?.[1] ?? null;
    return { blob: await res.blob(), fileName };
  },

  // ---- Weekly FACT reports: Excel-accurate PDF conversion -----------------------------

  /** Converts a Weekly FACT workbook (FACT category / RANK / LOW RANK / LOW MARK — see
   *  weeklyFactPdf.ts's file-level comment for why these moved off the jsPDF path) into a PDF
   *  that matches Excel's own File > Export > Create PDF pixel-for-pixel, via a LibreOffice
   *  headless conversion run by this app's own Next.js server (frontend/src/app/api/weekly-fact
   *  /pdf/route.ts) — a relative path, not API_BASE, since that route lives here, not on the
   *  .NET backend. */
  convertWeeklyFactPdf: async (buffer: ArrayBuffer, filename: string): Promise<Blob> => {
    const res = await fetch("/api/weekly-fact/pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-filename": encodeURIComponent(filename),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: buffer,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // Plain-text error body — use as-is.
      }
      throw new Error(message || `PDF conversion failed: ${res.status} ${res.statusText}`);
    }
    return res.blob();
  },

  /** Generic .xlsx -> PDF conversion (frontend/src/app/api/reports/xlsx-to-pdf/route.ts) —
   *  the same headless-LibreOffice mechanism as convertWeeklyFactPdf above, for any other
   *  report's already-built workbook rather than a Weekly-FACT-specific one. */
  convertXlsxToPdf: async (buffer: ArrayBuffer, filename: string): Promise<Blob> => {
    const res = await fetch("/api/reports/xlsx-to-pdf", {
      method: "POST",
      headers: {
        "Content-Type": "application/octet-stream",
        "x-filename": encodeURIComponent(filename),
        ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
      },
      body: buffer,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      let message = text;
      try {
        message = (JSON.parse(text) as { error?: string }).error ?? text;
      } catch {
        // Plain-text error body — use as-is.
      }
      throw new Error(message || `PDF conversion failed: ${res.status} ${res.statusText}`);
    }
    return res.blob();
  },

  // ---- auction reports (Combined Report / Top Prices) --------------------------------

  getCombinedReport: (catalogueId: string) => request<CombinedReport>(`/api/v1/auction-reports/${catalogueId}/combined`),

  getAuctionReport: (catalogueId: string, reportKey: string) =>
    request<AuctionReport>(`/api/v1/auction-reports/${catalogueId}/${reportKey}`),

  getMarketBulletin: (catalogueId: string) => request<MarketBulletin>(`/api/v1/market-bulletin/${catalogueId}`),

  // Combined Report from an uploaded workbook instead of an imported Catalogue — mirrors the
  // original standalone tool's own single-dropzone flow for a sale that isn't in the system yet.
  getCombinedReportFromUpload: async (file: File, saleNo?: string): Promise<CombinedReport> => {
    const form = new FormData();
    form.append("file", file);
    if (saleNo) form.append("saleNo", saleNo);
    const res = await fetch(`${API_BASE}/api/v1/auction-reports/from-upload/combined`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Couldn't generate the combined report from this file");
    }
    return res.json();
  },

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

  importCatalogue: async (file: File, year?: number): Promise<CatalogueDetail> => {
    const form = new FormData();
    form.append("file", file);
    if (year) form.append("year", String(year));
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

  mslFilteredAnalytics: (filter: MslAnalyticsFilter, signal?: AbortSignal) =>
    request<FilteredAnalytics>("/api/v1/msl/analytics/filtered", {
      method: "POST",
      body: JSON.stringify(filter),
      signal,
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

  // ---- MSL archive ----

  mslStatus: () => request<MslStatus>("/api/v1/msl/status"),

  mslRescan: (force = false) =>
    request<MslScanSummary>(`/api/v1/msl/rescan?force=${force}`, { method: "POST" }),

  /** Admin upload into the MSL archive — see data/msl/README.md's "Adding new data" routine
   *  (this drives the same placement, just from the Admin Panel). `type` is "auction",
   *  "private" or "teaboard"; `year`/`saleNo`/`month` are required per type (see
   *  MslController.Upload). Triggers an immediate scan, so the returned summary reflects it. */
  uploadMslFile: async (
    type: "auction" | "private" | "teaboard",
    file: File,
    fields: { year?: number; saleNo?: number; month?: number }
  ): Promise<MslScanSummary> => {
    const form = new FormData();
    form.append("file", file);
    form.append("type", type);
    if (fields.year != null) form.append("year", String(fields.year));
    if (fields.saleNo != null) form.append("saleNo", String(fields.saleNo));
    if (fields.month != null) form.append("month", String(fields.month));
    const res = await fetch(`${API_BASE}/api/v1/msl/upload`, {
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

  /** Step 1 of the upload-batch review flow — drop in any mix of broker/private .TXT files
   *  and .ZIP archives; each candidate is content-sniffed (kind, year, sale, broker, a real
   *  row-count preview) and staged in a scratch folder, nothing touches data/msl or MongoDB
   *  yet (see MslController.StageBatch). The admin reviews the returned list, drops what
   *  they don't want, then calls commitMslBatch with the ones to keep. */
  stageMslFilesBatch: async (files: File[]): Promise<MslStageBatchResult> => {
    const form = new FormData();
    for (const f of files) form.append("files", f);
    const res = await fetch(`${API_BASE}/api/v1/msl/upload-batch/stage`, {
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

  /** Step 2 — moves the chosen staged files (by stagingId) into the real archive and runs
   *  one scan. Everything left in the batch (excluded or rejected) is cleaned up either way. */
  commitMslBatch: (batchId: string, keep: string[]) =>
    request<MslBatchUploadResult>("/api/v1/msl/upload-batch/commit", {
      method: "POST",
      body: JSON.stringify({ batchId, keep }),
    }),

  /** Drops a staged batch the admin decided not to import at all. Abandoned batches also
   *  expire on their own after 2 hours, so this is a courtesy, not the only cleanup path. */
  discardMslBatch: (batchId: string) =>
    request<void>(`/api/v1/msl/upload-batch/discard?batchId=${encodeURIComponent(batchId)}`, { method: "POST" }),

  /** Every file the importer currently tracks — the Admin Panel's "browse archive files"
   *  list, for reviewing or removing something imported previously, not just at upload time. */
  listMslFiles: () => request<MslTrackedFile[]>("/api/v1/msl/files"),

  /** Removes one file from the archive on disk and rescans — the scan is what drops that
   *  file's already-imported rows from MongoDB (see MslController.DeleteFile). */
  deleteMslFile: (path: string) =>
    request<MslScanSummary>(`/api/v1/msl/files?path=${encodeURIComponent(path)}`, { method: "DELETE" }),

  /** The dashboard widget and the full /market-pulse page both call this one endpoint —
   *  no separate client-side scoring/filtering logic exists, so they can never drift out
   *  of sync with each other or with what an admin's minRelevance override actually shows. */
  getMarketPulse: (filters: MarketPulseFilters = {}) => {
    const qs = new URLSearchParams();
    Object.entries(filters).forEach(([k, v]) => {
      if (v !== undefined && v !== null && v !== "") qs.set(k, String(v));
    });
    return request<MarketPulsePagedResult>(`/api/v1/market-pulse?${qs.toString()}`);
  },

  listMarketPulseSources: () => request<MarketPulseSource[]>("/api/v1/market-pulse/sources"),

  addMarketPulseSource: (source: { name: string; feedUrl: string; category: MarketPulseCategory; enabled?: boolean }) =>
    request<MarketPulseSource>("/api/v1/market-pulse/sources", { method: "POST", body: JSON.stringify(source) }),

  updateMarketPulseSource: (id: string, patch: { name?: string; feedUrl?: string; category?: MarketPulseCategory; enabled?: boolean }) =>
    request<MarketPulseSource>(`/api/v1/market-pulse/sources/${id}`, { method: "PUT", body: JSON.stringify(patch) }),

  deleteMarketPulseSource: (id: string) => request<void>(`/api/v1/market-pulse/sources/${id}`, { method: "DELETE" }),

  /** Runs the same ingestion pass the scheduled job runs, immediately — so an admin sees a
   *  newly-added source take effect without waiting for the next scheduled tick. */
  refreshMarketPulse: () => request<MarketPulseIngestionSummary>("/api/v1/market-pulse/refresh", { method: "POST" }),

  /** Public, unauthenticated — the /home landing page's ticker strip. */
  getPublicMarketPulseTicker: () => request<PublicMarketPulseItem[]>("/api/v1/market-pulse/public-ticker"),

  // ---- Landing Page CMS (public /home page + Admin Panel "Landing Page" section) -----
  getLandingContent: () => request<LandingPageContent>("/api/v1/landing-content"),
  getLandingContentForAdmin: () => request<LandingPageContent>("/api/v1/landing-content/admin"),
  updateLandingContent: (content: Omit<LandingPageContent, "updatedAt" | "updatedBy">) =>
    request<LandingPageContent>("/api/v1/landing-content", { method: "PUT", body: JSON.stringify(content) }),

  // ---- Request Access (public /request-access page + Admin Panel review list) --------
  submitAccessRequest: (fields: { name: string; email: string; company: string; message: string }) =>
    request<AccessRequest>("/api/v1/access-requests", { method: "POST", body: JSON.stringify(fields) }),
  listAccessRequests: () => request<AccessRequest[]>("/api/v1/access-requests"),
  markAccessRequestReviewed: (id: string) => request<void>(`/api/v1/access-requests/${id}/reviewed`, { method: "PATCH" }),

  // ---- Automated Reports (Admin Panel) — see backend/Modules/ScheduledReports ----

  listScheduledReportJobs: () => request<ScheduledReportJob[]>("/api/v1/admin/scheduled-reports"),

  toggleScheduledReportJob: (key: string, enabled: boolean) =>
    request<void>(`/api/v1/admin/scheduled-reports/${key}/toggle`, { method: "POST", body: JSON.stringify({ enabled }) }),

  runScheduledReportJobNow: (key: string) =>
    request<{ success: boolean; message: string }>(`/api/v1/admin/scheduled-reports/${key}/run-now`, { method: "POST" }),

  listScheduledReportOutputs: (key: string) =>
    request<ScheduledReportOutput[]>(`/api/v1/admin/scheduled-reports/${key}/outputs`),

  listStagedCbac: () => request<StagedCbac[]>("/api/v1/admin/weekly-fact/cbac"),

  stageCbac: (saleYear: number, saleNo: number, txtContent: string) =>
    request<void>("/api/v1/admin/weekly-fact/cbac", { method: "POST", body: JSON.stringify({ saleYear, saleNo, txtContent }) }),

  deleteStagedCbac: (saleYear: number, saleNo: number) =>
    request<void>(`/api/v1/admin/weekly-fact/cbac/${saleYear}/${saleNo}`, { method: "DELETE" }),

  // ---- Factory Sale Summary (Estate-wise / Owner-wise) --------------------------------

  generateFactorySaleSummary: (saleYear: number, saleNo: number) =>
    request<ScheduledReportOutput>("/api/v1/reports/factory-sale-summary/generate", {
      method: "POST",
      body: JSON.stringify({ saleYear, saleNo }),
    }),

  listFactorySaleSummaryOutputs: () => request<ScheduledReportOutput[]>("/api/v1/reports/factory-sale-summary/outputs"),

  // ---- Sharing Mark Catalogued Summary (manual-only — see the report's own page) ------

  // Both generate endpoints return TWO outputs per call — one for Low Grown, one for High &
  // Medium Grown — mirroring the user's original two separate hand-built files rather than
  // one combined workbook (see SharedMarkCatalogueGenerationService's own doc comment).
  /** UnmatchedMarks: estate names in the report whose code had no elevation history
   *  anywhere on file — defaulted to High & Medium Grown with no way to confirm that's
   *  actually correct (see backend SharedMarkCatalogueService's own doc comment). Always
   *  empty for the /data/sales-sourced generate call, since those lots already carry real
   *  elevation. */
  generateSharedMarkCatalogueSummary: (saleYear: number, saleNo: number) =>
    request<SharedMarkCatalogueGenerateResponse>("/api/v1/reports/shared-mark-catalogue-summary/generate", {
      method: "POST",
      body: JSON.stringify({ saleYear, saleNo }),
    }),

  /** files is keyed by broker code (BrokerCode.All on the backend: ASC, EB, BC, JK, LC,
   *  MPB, FW, CT) — all 8 are required, matched by the backend on field name "file_{code}". */
  generateSharedMarkCatalogueSummaryFromUpload: async (
    files: Record<string, File>,
    saleYear: number,
    saleNo: number,
    saleDate: string,
  ): Promise<SharedMarkCatalogueGenerateResponse> => {
    const form = new FormData();
    form.append("saleYear", String(saleYear));
    form.append("saleNo", String(saleNo));
    form.append("saleDate", saleDate);
    for (const [broker, file] of Object.entries(files)) form.append(`file_${broker}`, file);
    const res = await fetch(`${API_BASE}/api/v1/reports/shared-mark-catalogue-summary/generate-from-upload`, {
      method: "POST",
      headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      body: form,
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Couldn't generate this report from the uploaded files");
    }
    return res.json();
  },

  listSharedMarkCatalogueSummaryOutputs: () =>
    request<ScheduledReportOutput[]>("/api/v1/reports/shared-mark-catalogue-summary/outputs"),

  // ---- Category Analysis (Price & Classification — Sale x Broker) ---------------------

  listCategoryOptions: () => request<CategoryOption[]>("/api/v1/reports/category-analysis/categories"),

  previewCategoryAnalysis: (category: string, catalogueIds: string[]) => {
    const qs = new URLSearchParams({ category });
    for (const id of catalogueIds) qs.append("catalogueIds", id);
    return request<CategoryAnalysis>(`/api/v1/reports/category-analysis/preview?${qs.toString()}`);
  },

  generateCategoryAnalysis: (category: string, catalogueIds: string[]) =>
    request<ScheduledReportOutput>("/api/v1/reports/category-analysis/generate", {
      method: "POST",
      body: JSON.stringify({ category, catalogueIds }),
    }),

  listCategoryAnalysisOutputs: () => request<ScheduledReportOutput[]>("/api/v1/reports/category-analysis/outputs"),

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
