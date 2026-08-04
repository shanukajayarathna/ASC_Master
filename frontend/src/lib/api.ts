import type {
  AccuracyBucket,
  AccuracyOverview,
  AuthResponse,
  AuthUser,
  BrokerStats,
  CatalogueDetail,
  CatalogueSummary,
  ChatMessage,
  ChatResponse,
  Conversation,
  DashboardStats,
  DataQuality,
  DocumentSearchResult,
  FilterPreset,
  ImportActualsResult,
  ImportStatus,
  KnowledgeDocument,
  Lot,
  MarketInsight,
  OverviewStats,
  PagedLots,
  PreviousGradeStats,
  Report,
  ReportGroupRow,
  SavedReport,
  TopBottomLot,
  ValuationUpdate,
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  return res.json() as Promise<T>;
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

  setUserRole: (id: string, role: "Admin" | "User") =>
    request<AuthUser>(`/api/v1/auth/users/${id}/role`, { method: "PATCH", body: JSON.stringify({ role }) }),

  deleteUser: (id: string) => request<void>(`/api/v1/auth/users/${id}`, { method: "DELETE" }),

  changePassword: (currentPassword: string, newPassword: string) =>
    request<void>("/api/v1/auth/change-password", {
      method: "POST",
      body: JSON.stringify({ currentPassword, newPassword }),
    }),

  // ---- knowledge base ---------------------------------------------------------------
  // Unlike every call below this point, these endpoints actually require login — so the
  // multipart upload (which bypasses `request()`'s auto-attached header, same as
  // importCatalogue below) has to attach Authorization itself.

  uploadDocument: async (file: File): Promise<KnowledgeDocument> => {
    const form = new FormData();
    form.append("file", file);
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

  // ---- AI assistant ------------------------------------------------------------------

  sendChatMessage: (message: string, conversationId?: string) =>
    request<ChatResponse>("/api/v1/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ conversationId: conversationId ?? null, message }),
    }),

  listConversations: () => request<Conversation[]>("/api/v1/assistant/conversations"),

  getConversationMessages: (id: string) => request<ChatMessage[]>(`/api/v1/assistant/conversations/${id}/messages`),

  // ---- reports ------------------------------------------------------------------------

  generateReport: (catalogueId: string, type: string) => request<Report>(`/api/v1/reports/${catalogueId}/${type}`),

  exportReportExcel: async (catalogueId: string, type: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/v1/reports/${catalogueId}/${type}/excel`, {
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
