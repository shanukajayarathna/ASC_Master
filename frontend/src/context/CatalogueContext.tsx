"use client";

import { api } from "@/lib/api";
import type { CatalogueDetail, CatalogueSummary } from "@/types/api";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

interface CatalogueCtx {
  catalogues: CatalogueSummary[];
  activeCatalogue: CatalogueDetail | null;
  activeCatalogueId: string | null;
  loading: boolean;
  error: string | null;
  refreshList: () => Promise<void>;
  selectCatalogue: (id: string | null) => Promise<void>;
  /** Import a sale file. Returns the new catalogue; pass `{ select: false }` to add it to the
   *  list without switching the active sale (e.g. to fold it into a multi-sale selection). */
  importFile: (file: File, options?: { select?: boolean }) => Promise<CatalogueDetail>;
  removeCatalogue: (id: string) => Promise<void>;
}

const Ctx = createContext<CatalogueCtx | null>(null);

export function CatalogueProvider({ children }: { children: React.ReactNode }) {
  const [catalogues, setCatalogues] = useState<CatalogueSummary[]>([]);
  const [activeCatalogue, setActiveCatalogue] = useState<CatalogueDetail | null>(null);
  const [activeCatalogueId, setActiveCatalogueId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      setError(null);
      const list = await api.listCatalogues();
      setCatalogues(list);
      return list;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the API");
      return [];
    }
  }, []);

  const selectCatalogue = useCallback(async (id: string | null) => {
    setActiveCatalogueId(id);
    window.localStorage.setItem("asc_active_catalogue", id ?? "");
    if (!id) {
      setActiveCatalogue(null);
      return;
    }
    setLoading(true);
    try {
      setError(null);
      const detail = await api.getCatalogue(id);
      setActiveCatalogue(detail);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load catalogue");
      setActiveCatalogue(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    (async () => {
      const list = await refreshList();
      const stored = window.localStorage.getItem("asc_active_catalogue");
      const initial = stored && list.some((c) => c.id === stored) ? stored : list[0]?.id ?? null;
      if (initial) await selectCatalogue(initial);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const importFile = useCallback(
    async (file: File, options?: { select?: boolean }) => {
      setLoading(true);
      try {
        setError(null);
        const detail = await api.importCatalogue(file);
        await refreshList();
        if (options?.select !== false) await selectCatalogue(detail.id);
        return detail;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Import failed");
        throw e;
      } finally {
        setLoading(false);
      }
    },
    [refreshList, selectCatalogue]
  );

  const removeCatalogue = useCallback(
    async (id: string) => {
      await api.deleteCatalogue(id);
      const list = await refreshList();
      if (activeCatalogueId === id) {
        await selectCatalogue(list[0]?.id ?? null);
      }
    },
    [activeCatalogueId, refreshList, selectCatalogue]
  );

  const value = useMemo<CatalogueCtx>(
    () => ({
      catalogues,
      activeCatalogue,
      activeCatalogueId,
      loading,
      error,
      refreshList: async () => {
        await refreshList();
      },
      selectCatalogue,
      importFile,
      removeCatalogue,
    }),
    [catalogues, activeCatalogue, activeCatalogueId, loading, error, refreshList, selectCatalogue, importFile, removeCatalogue]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCatalogue() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useCatalogue must be used within CatalogueProvider");
  return ctx;
}
