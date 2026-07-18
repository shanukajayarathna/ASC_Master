import type { Lot } from "@/types/api";

/**
 * The deliberate filter shortlist that replaced the old one-filter-per-column wall —
 * real market catalogues carry ~50 columns and a filter for each was unusable.
 *
 * Each entry names the filter as the user knows it and lists header patterns tried in
 * order against the catalogue's real headers (spellings drift between files; first hit
 * wins). A filter whose column is missing — or empty in the loaded catalogue — simply
 * doesn't render.
 */
export interface CuratedFilterDef {
  label: string;
  patterns: RegExp[];
}

/** Dropdown (typeahead) filters, in display order. */
export const CURATED_FILTERS: CuratedFilterDef[] = [
  { label: "Sale Code", patterns: [/^sale.?code$/i] },
  { label: "Category", patterns: [/^categ/i] },
  { label: "Buyer", patterns: [/^buyer.?name$/i, /^buyer$/i] },
  { label: "Broker", patterns: [/^broker$/i] },
  { label: "Lot Number", patterns: [/^lot.?no/i] },
  { label: "Invoice No", patterns: [/^invoice/i] },
  { label: "Standard / Adjective", patterns: [/standard.?\/?.?adjective/i, /^standard$/i, /^adjective$/i] },
  { label: "Factory Name", patterns: [/^factory.?name$/i, /^factory$/i] },
  { label: "Grade", patterns: [/^grade$/i] },
  { label: "Certification", patterns: [/^certification/i] },
  { label: "Elevation", patterns: [/elevat/i] },
  { label: "Transaction Type", patterns: [/^transaction.?type$/i] },
  { label: "Country", patterns: [/country/i] },
  { label: "Producer", patterns: [/^producer$/i] },
  { label: "MF No", patterns: [/^trade.?mark$/i, /^mf.?no/i] },
  { label: "Selling Mark", patterns: [/^selling.?mark$/i] },
];

/** Tick-box groups on known fixed-choice columns (Status, RP = reprint, RA = rainforest). */
export const TICK_FILTERS: { label: string; patterns: RegExp[]; options: string[] }[] = [
  { label: "Sale Status", patterns: [/^status$/i, /post.?sale.?status/i], options: ["Sold", "Outsold", "Unsold"] },
  { label: "Reprint", patterns: [/^rp$/i, /^reprint$/i], options: ["Yes", "No"] },
  { label: "Rainforest", patterns: [/^ra$/i, /rainforest/i], options: ["Yes", "No"] },
];

/** First header matching any of the patterns, or null when the catalogue lacks the column. */
export function resolveHeader(headers: string[], patterns: RegExp[]): string | null {
  for (const p of patterns) {
    const hit = headers.find((h) => p.test(h.trim()));
    if (hit) return hit;
  }
  return null;
}

/**
 * Distinct values of a column across the loaded lots, most frequent first (ties
 * alphabetical) — the order the dropdown shows them in, so the handful visible before
 * typing are the ones most likely wanted.
 */
export function columnOptions(lots: Lot[], header: string): string[] {
  const counts = new Map<string, number>();
  for (const lot of lots) {
    const v = (lot.rawData[header] ?? "").trim();
    if (v) counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([v]) => v);
}
