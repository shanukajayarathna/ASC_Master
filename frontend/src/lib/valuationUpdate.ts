import type { Lot, ValuationUpdate } from "@/types/api";

/**
 * The PATCH /api/lots/{id}/valuation endpoint replaces every valuation field with whatever
 * is in the request body (only Classification is left untouched when omitted) — so any
 * caller that wants to change just one field (e.g. Quick Fill setting only Valuation) MUST
 * start from the lot's current valuation and patch on top of it, or every other field
 * (remarks, classification, etc.) gets silently wiped back to empty.
 */
export function buildValuationUpdate(lot: Lot, patch: Partial<ValuationUpdate>): ValuationUpdate {
  const v = lot.valuation;
  return {
    valuationFrom: v?.valuationFrom ?? null,
    valuationTo: v?.valuationTo ?? null,
    valuationSingle: v?.valuationSingle ?? null,
    classification: v?.classification ?? "Unclassified",
    standardData: v?.standardData ?? null,
    adjectiveData: v?.adjectiveData ?? null,
    liquorRemarks: v?.liquorRemarks ?? null,
    musterReport: v?.musterReport ?? null,
    brokerNotes: v?.brokerNotes ?? null,
    privateNotes: v?.privateNotes ?? null,
    ...patch,
  };
}
