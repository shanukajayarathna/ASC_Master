// "Sharings" — the same garden mark + grade offered by more than one broker in the same
// sale. A tea taster valuing an Asia Siyaka (ASC) lot wants to see the other brokers'
// lots of that exact mark and grade (their packing, asking prices, our own valuations)
// to compare against before settling on a value. Same-or-different packing is expected;
// the comparison is what informs the price.

import type { Lot } from "@/types/api";
import { sellingMarkOf } from "@/lib/lotDisplay";
import { sortForDisplay } from "@/lib/ourBroker";

const norm = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();

/**
 * The key two lots share when they're the same selling mark (garden) and grade. Null when
 * either is missing — a lot with no mark or no grade can't be matched to a sharing.
 */
export function sharingKey(lot: Lot): string | null {
  const mark = norm(sellingMarkOf(lot));
  const grade = norm(lot.grade);
  if (!mark || !grade) return null;
  return `${mark}||${grade}`;
}

export type SharingIndex = Map<string, Lot[]>;

/** Group a whole sale's lots by mark+grade once, so each lot's sharings are an O(1) lookup. */
export function buildSharingIndex(lots: Lot[]): SharingIndex {
  const map: SharingIndex = new Map();
  for (const lot of lots) {
    const key = sharingKey(lot);
    if (!key) continue;
    const arr = map.get(key);
    if (arr) arr.push(lot);
    else map.set(key, [lot]);
  }
  return map;
}

/**
 * The other lots in the sale sharing this lot's mark + grade (this lot itself excluded),
 * ordered our-own-first then by broker — the same order the lot lists use.
 */
export function sharingsFor(index: SharingIndex, lot: Lot): Lot[] {
  const key = sharingKey(lot);
  if (!key) return [];
  const group = index.get(key);
  if (!group) return [];
  return sortForDisplay(group.filter((l) => l.id !== lot.id));
}
