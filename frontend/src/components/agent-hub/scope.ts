"use client";

import { api } from "@/lib/api";
import type { ChatScope } from "@/types/api";
import type { CatalogueSummary } from "@/types/api";
import { useEffect, useState } from "react";

const KEY = "asc.assistant.scope";

export interface ArchiveSale {
  year: number;
  saleNo: number;
  catalogueId?: string;
  sourceName?: string;
}

/** Newest first, private-sale buckets (sale 0) left out. */
export function useArchiveSales(): ArchiveSale[] {
  const [sales, setSales] = useState<ArchiveSale[]>([]);
  useEffect(() => {
    let cancelled = false;
    api
      .mslAnalyticsSales()
      .then((rows) => {
        if (cancelled) return;
        setSales(rows.filter((r) => r.saleNo > 0).map((r) => ({ year: r.year, saleNo: r.saleNo })).sort((a, b) => b.year - a.year || b.saleNo - a.saleNo));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);
  return sales;
}

/** Sale catalogues come from the live OKLO feed and imported/downloaded files. */
export function useCatalogueSales(): ArchiveSale[] {
  const [sales, setSales] = useState<ArchiveSale[]>([]);
  useEffect(() => {
    let cancelled = false;
    api.listCatalogues().then((rows: CatalogueSummary[]) => {
      if (cancelled) return;
      const mapped = rows.flatMap((r) => {
        const match = /sale\s*(\d+)/i.exec(r.sourceName);
        return match ? [{ year: r.year, saleNo: Number(match[1]), catalogueId: r.id, sourceName: r.sourceName }] : [];
      });
      setSales(mapped.sort((a, b) => b.year - a.year || b.saleNo - a.saleNo));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return sales;
}

const two = (n: number) => String(n).padStart(2, "0");

/** The scope in words: "sale 32/2026", "sales 28/2026–32/2026", "the whole of 2026", "the years 2025–2026". */
export function describeScope(scope: ChatScope | null): string {
  if (!scope) return "All sales";
  const { fromYear, fromSale, toYear, toSale } = scope;
  const label = fromSale != null && fromSale === toSale && fromYear === toYear ? `Sale ${two(fromSale)}/${fromYear}`
    : fromSale == null && toSale == null ? fromYear === toYear ? `Year ${fromYear}` : `Years ${fromYear}–${toYear}`
    : `Sales ${two(fromSale ?? 1)}/${fromYear}–${two(toSale ?? 99)}/${toYear}`;
  return scope.source === "catalogue" ? `OKLO / files · ${label}` : scope.source === "both" ? `MSL + OKLO / files · ${label}` : `MSL archive · ${label}`;
}

/** Null when the scope is usable; otherwise why not (the same limits the server enforces). */
export function scopeProblem(scope: ChatScope | null): string | null {
  if (!scope) return null;
  const from = scope.fromYear * 100 + (scope.fromSale ?? 1);
  const to = scope.toYear * 100 + (scope.toSale ?? 99);
  if (to < from) return "The end can't be before the start.";
  if (scope.source !== "catalogue" && scope.toYear - scope.fromYear + 1 > 3) return "Choose at most three years at a time.";
  return null;
}

export function readScope(): ChatScope | null {
  try {
    const raw = window.localStorage.getItem(KEY);
    const s = raw ? (JSON.parse(raw) as ChatScope) : null;
    return s && Number.isInteger(s.fromYear) && Number.isInteger(s.toYear) && scopeProblem(s) === null ? s : null;
  } catch {
    return null;
  }
}

export function saveScope(scope: ChatScope | null) {
  try {
    if (scope) window.localStorage.setItem(KEY, JSON.stringify(scope));
    else window.localStorage.removeItem(KEY);
  } catch {
    /* storage blocked: the scope still applies for this visit */
  }
}
