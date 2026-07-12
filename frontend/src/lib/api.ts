import type {
  CatalogueDetail,
  CatalogueSummary,
  DashboardStats,
  Lot,
  PagedLots,
  ValuationUpdate,
} from "@/types/api";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058";

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

  updateValuation: (lotId: string, dto: ValuationUpdate) =>
    request<Lot>(`/api/lots/${lotId}/valuation`, {
      method: "PATCH",
      body: JSON.stringify(dto),
    }),

  bulkClassify: (lotIds: string[], classification: string) =>
    request<{ updated: number }>("/api/lots/bulk-classify", {
      method: "POST",
      body: JSON.stringify({ lotIds, classification }),
    }),

  bulkClearNotes: (lotIds: string[]) =>
    request<{ updated: number }>("/api/lots/bulk-clear-notes", {
      method: "POST",
      body: JSON.stringify({ lotIds }),
    }),
};
