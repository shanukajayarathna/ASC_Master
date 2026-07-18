import type { Lot } from "@/types/api";

// The dataset's own header spelling varies catalogue to catalogue (e.g. "SellingMark" vs
// "Selling Mark"), and these fields aren't promoted to typed Lot properties the way
// LotNumber/Grade/Mark are — so look them up from rawData by fuzzy header match instead.
function findRaw(lot: Lot, pattern: RegExp): string | null {
  const entry = Object.entries(lot.rawData).find(([k]) => pattern.test(k));
  return entry?.[1]?.trim() || null;
}

export function sellingMarkOf(lot: Lot): string | null {
  return findRaw(lot, /selling.?mark/i);
}

export function noOfChestsOf(lot: Lot): string | null {
  // The real weekly-sale files call the chest count "Bags".
  return findRaw(lot, /no.?of.?chests?|^chests?$|^bags?$/i);
}

export function weightPerChestOf(lot: Lot): string | null {
  // In the real files the per-bag weight is "Net Weight" (the lot total is "Total
  // Weight") — the exact-match pattern deliberately misses legacy "NettWeight" totals.
  return findRaw(lot, /weight.?per.?chest/i) ?? findRaw(lot, /^net\s?weight$/i);
}

export function markCodeOf(lot: Lot): string | null {
  return findRaw(lot, /mark.?code/i);
}

export function askingPriceOf(lot: Lot): string | null {
  return findRaw(lot, /asking/i);
}

export function minimumLimitOf(lot: Lot): string | null {
  // "Baseline Price" is the reserve/minimum in the real weekly-sale files.
  return findRaw(lot, /min(imum)?[\s._-]*(limit|price)/i) ?? findRaw(lot, /^min(imum)?$/i) ?? findRaw(lot, /baseline/i);
}

export function catalogueRemarkOf(lot: Lot): string | null {
  return findRaw(lot, /^remarks?$/i);
}

export function catalogueStandardOf(lot: Lot): string | null {
  return findRaw(lot, /standard/i);
}

export function lotLabel(lot: Lot): string {
  return [lot.lotNumber ? `Lot ${lot.lotNumber}` : null, lot.grade, lot.mark].filter(Boolean).join(" · ") || lot.rowKey;
}

export function hasValuation(lot: Lot): boolean {
  const v = lot.valuation;
  return !!v && (v.valuationSingle != null || (v.valuationFrom != null && v.valuationTo != null));
}

export function valuationToText(lot: Lot): string {
  const v = lot.valuation;
  if (!v) return "";
  if (v.valuationSingle != null) return v.valuationSingle.toString();
  if (v.valuationFrom != null && v.valuationTo != null) return `${v.valuationFrom}-${v.valuationTo}`;
  return "";
}
