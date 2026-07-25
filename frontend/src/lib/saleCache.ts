import { api } from "@/lib/api";
import type { SaleEntry } from "@/lib/multiSale";
import type { Lot } from "@/types/api";

/**
 * Shared in-memory cache of loaded sales, sitting between the pages that show a whole sale
 * (Catalogue Manager, Valuation Centre, Worksheet) and the API. A "sale" here is its headers
 * plus every lot — fetched once and kept, so the heavy 20k-lot load doesn't repeat every time
 * the same sale is re-selected, pooled into a multi-sale set, or reopened on another page.
 *
 * Correctness rests on invalidation: any edit to a sale's lots must either patch the cached
 * lot (patchCachedLot) or drop the sale (invalidateSale), so a later load never serves stale
 * data. The pages that mutate lots do exactly that.
 */

// Big enough to hold a full weekly sale (~12k lots) in one fetch.
const LARGE_PAGE_SIZE = 20000;

// How many sales to keep resident at once. Each can be ~12k lots, so this is a deliberate
// ceiling — past it the least-recently-used sale is evicted. Comfortably covers a multi-sale
// pool plus a few recently-visited sales; evicting one only means the next load refetches it.
const MAX_CACHED_SALES = 12;

// saleId -> the in-flight-or-settled load. Storing the promise (not the resolved value)
// dedupes concurrent loads of the same sale and lets every caller await the one fetch.
const cache = new Map<string, Promise<SaleEntry>>();

async function fetchSale(id: string): Promise<SaleEntry> {
  const [detail, paged] = await Promise.all([
    api.getCatalogue(id),
    api.getLots(id, { pageSize: LARGE_PAGE_SIZE }),
  ]);
  return { id, sourceName: detail.sourceName, detail, lots: paged.rows };
}

/**
 * Load a sale (headers + all lots), served from memory once loaded. Re-selecting a sale,
 * pooling it into a multi-sale set, or moving between the Catalogue / Valuation / Worksheet
 * pages for the same sale all hit the cache instead of the network.
 *
 * A rejected load is never retained, so a failed fetch can be retried on the next call.
 */
export function loadSale(id: string): Promise<SaleEntry> {
  const cached = cache.get(id);
  if (cached) {
    // LRU touch: re-insert at the newest position so it outlives colder entries.
    cache.delete(id);
    cache.set(id, cached);
    return cached;
  }
  const pending = fetchSale(id).catch((err) => {
    cache.delete(id);
    throw err;
  });
  cache.set(id, pending);
  if (cache.size > MAX_CACHED_SALES) {
    const oldest = cache.keys().next().value; // Map keeps insertion / touch order
    if (oldest !== undefined) cache.delete(oldest);
  }
  return pending;
}

/**
 * Fold a saved lot into its cached sale in place, keeping the cache warm through per-lot
 * edits — no refetch needed, and a later load still reflects the change. A no-op when the
 * sale isn't cached.
 */
export function patchCachedLot(saleId: string, updated: Lot): void {
  const cached = cache.get(saleId);
  if (!cached) return;
  void cached.then((entry) => {
    const idx = entry.lots.findIndex((l) => l.id === updated.id);
    if (idx !== -1) entry.lots[idx] = updated;
  });
}

/** Drop one sale — call after a bulk edit whose per-lot results aren't returned, so the
 *  next load refetches it fresh. */
export function invalidateSale(id: string): void {
  cache.delete(id);
}

/** Drop every cached sale. */
export function invalidateAllSales(): void {
  cache.clear();
}
