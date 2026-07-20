// Asia Siyaka's own lots are what the tea tasters work on day to day, so both lot
// workspaces (Catalogue Manager and the Valuation Centre) put them at the top of the sale.
// Ordering only — no filter is applied, so every other broker's lots are still right there
// underneath without anything to clear first.

import type { Lot } from "@/types/api";

/** Our broker code exactly as the sale files' Broker column spells it. */
export const OUR_BROKER = "ASC";

/** Lot numbers are plain integers, so they sort numerically — "9" comes before "10". */
function lotNumberOf(lot: Lot): number {
  const n = parseInt((lot.lotNumber ?? "").replace(/\D/g, ""), 10);
  return Number.isNaN(n) ? Number.POSITIVE_INFINITY : n;
}

/**
 * Display order for a whole sale: our own lots first, then the other brokers
 * alphabetically, each block ascending by lot number (every broker's numbering restarts
 * at 1, so lot number alone would interleave them).
 */
export function sortForDisplay(lots: Lot[]): Lot[] {
  return [...lots].sort((a, b) => {
    const ab = a.broker ?? "";
    const bb = b.broker ?? "";
    if (ab !== bb) {
      if (ab === OUR_BROKER) return -1;
      if (bb === OUR_BROKER) return 1;
      return ab.localeCompare(bb);
    }
    return lotNumberOf(a) - lotNumberOf(b);
  });
}
