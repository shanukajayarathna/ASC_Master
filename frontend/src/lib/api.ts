import type {
  CatalogueDetail,
  CatalogueSummary,
  DashboardStats,
  Lot,
  PagedLots,
  PreviousGradeStats,
  ValuationUpdate,
} from "@/types/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058";

/** What media a lot currently has: a photo, and which remark fields carry a voice note. */
export interface LotMedia {
  photo: boolean;
  voice: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(text || `Request failed: ${res.status} ${res.statusText}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const api = {
  listCatalogues: () => request<CatalogueSummary[]>("/api/catalogues"),

  getCatalogue: (id: string) => request<CatalogueDetail>(`/api/catalogues/${id}`),

  deleteCatalogue: (id: string) =>
    request<void>(`/api/catalogues/${id}`, { method: "DELETE" }),

  importCatalogue: async (file: File): Promise<CatalogueDetail> => {
    const form = new FormData();
    form.append("file", file);
    const res = await fetch(`${API_BASE}/api/catalogues/import`, {
      method: "POST",
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

  /** <img>/<audio> src straight to the API. Pass `v` (a version/timestamp) to bust the
   *  browser cache after a photo is replaced or deleted. */
  photoUrl: (lotId: string, v?: number | string) =>
    `${API_BASE}/api/lots/${lotId}/photo${v != null ? `?v=${v}` : ""}`,

  voiceUrl: (lotId: string, field: string, v?: number | string) =>
    `${API_BASE}/api/lots/${lotId}/voice/${field}${v != null ? `?v=${v}` : ""}`,

  /** Load the stored photo as a blob (same-origin object URL) so it can be re-cropped
   *  in a canvas without cross-origin taint. */
  fetchPhotoBlob: async (lotId: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/photo`);
    if (!res.ok) throw new Error("Could not load the photo.");
    return res.blob();
  },

  uploadPhoto: async (lotId: string, blob: Blob): Promise<LotMedia> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/photo`, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "image/jpeg" },
      body: blob,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Photo upload failed.");
    return res.json();
  },

  deletePhoto: async (lotId: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/photo`, { method: "DELETE" });
    if (!res.ok) throw new Error("Could not delete the photo.");
  },

  /** Load a stored voice note as a blob so it plays from a same-origin object URL — more
   *  reliable across browsers than a cross-origin <audio src> with range requests. */
  fetchVoiceBlob: async (lotId: string, field: string): Promise<Blob> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/voice/${field}`);
    if (!res.ok) throw new Error("Could not load the voice note.");
    return res.blob();
  },

  uploadVoice: async (lotId: string, field: string, blob: Blob): Promise<LotMedia> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/voice/${field}`, {
      method: "PUT",
      headers: { "Content-Type": blob.type || "audio/webm" },
      body: blob,
    });
    if (!res.ok) throw new Error((await res.text().catch(() => "")) || "Voice upload failed.");
    return res.json();
  },

  deleteVoice: async (lotId: string, field: string): Promise<void> => {
    const res = await fetch(`${API_BASE}/api/lots/${lotId}/voice/${field}`, { method: "DELETE" });
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lots, columns }),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || "Export failed");
    }
    return res.blob();
  },
};
