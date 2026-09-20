"use client";

import { api } from "@/lib/api";
import { useEffect, useState } from "react";

export interface SaleRef {
  year: number;
  saleNo: number;
}

/** "Sale 39 - 2026 · 10,850 lots" -> {39, 2026}. Null when the name has no sale number. */
export function parseSaleName(name: string | null | undefined): SaleRef | null {
  const m = name?.match(/sale\s*(\d+)\s*[-–/]\s*(\d{4})/i);
  return m ? { saleNo: Number(m[1]), year: Number(m[2]) } : null;
}

const isAfter = (a: SaleRef, b: SaleRef) => a.year > b.year || (a.year === b.year && a.saleNo > b.saleNo);
const fmt = (s: SaleRef) => `${String(s.saleNo).padStart(2, "0")}/${s.year}`;

/** The plain-language gap between the archive and the active sale, or null when the archive is up to date (or unknown). */
export function archiveGap(latestArchived: SaleRef | null, active: SaleRef | null): { archived: string; active: string } | null {
  if (!latestArchived || !active || !isAfter(active, latestArchived)) return null;
  return { archived: fmt(latestArchived), active: fmt(active) };
}

/**
 * The newest sale in the MSL archive, from the per-sale rollups (cheap — never a scan of the lots). Null while
 * loading or if it can't be read; the notice then simply doesn't show rather than guessing.
 */
export function useLatestArchivedSale(): SaleRef | null {
  const [latest, setLatest] = useState<SaleRef | null>(null);
  useEffect(() => {
    let cancelled = false;
    api
      .mslAnalyticsSales()
      .then((rows) => {
        // saleNo 0 is a year's private-sales bucket, not a sale.
        const top = rows.filter((r) => r.saleNo > 0).sort((a, b) => b.year - a.year || b.saleNo - a.saleNo)[0];
        if (!cancelled && top) setLatest({ year: top.year, saleNo: top.saleNo });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return latest;
}
