import { api } from "@/lib/api";
import type { SaleEntry } from "@/lib/multiSale";
import type { Lot, PagedLots } from "@/types/api";

/**
 * Shared in-memory cache of loaded sales, sitting between the pages that show a whole sale
 * (Catalogue Reports, Valuation Centre, Worksheet) and the API. A "sale" here is its headers
 * plus every lot — fetched once and kept, so the heavy 20k-lot load doesn't repeat every time
 * the same sale is re-selected, pooled into a multi-sale set, or reopened on another page.
 *
 * Sales served live from OKLO arrive in pieces: the backend loads them page by page into memory
 * (first rows in a few seconds, the whole sale in about a minute), and this cache follows along —
 * `loadSaleProgressive` resolves as soon as the first rows exist and the entry keeps growing, while
 * `loadSale` resolves only when the whole sale is here (what the other pages expect). Once complete,
 * a cheap version poll notices when the backend has re-pulled the sale and swaps in the fresh rows,
 * so an open page stays current without reloads. File-backed sales load in one shot as before.
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

/** How often to ask the backend for rows that arrived since the last poll while a sale is loading. */
const PROGRESS_POLL_MS = 1500;
/** How often an open, complete live sale is checked for a newer pull. */
const FRESHNESS_POLL_MS = 30_000;
const MAX_POLL_FAILURES = 5;

export interface SaleStatus {
  /** Served live from OKLO (false = read from a file, always complete). */
  live: boolean;
  loaded: number;
  total: number;
  complete: boolean;
  /** When the backend last finished pulling this sale — null for file-backed sales. */
  fetchedAtUtc: string | null;
  /** The backend is re-pulling the sale in the background. */
  refreshing: boolean;
  error: string | null;
}

interface SaleState {
  id: string;
  entry: SaleEntry | null;
  status: SaleStatus;
  /** Resolves when the first rows are available. */
  first: Promise<SaleEntry>;
  /** Resolves when the whole sale is here. */
  done: Promise<SaleEntry>;
  listeners: Set<() => void>;
  watchTimer: ReturnType<typeof setInterval> | null;
  reconciling: boolean;
}

// saleId -> its load. Storing the state (with its promises) dedupes concurrent loads of the same
// sale and lets every caller await the one fetch. Map order doubles as the LRU order.
const cache = new Map<string, SaleState>();

const EMPTY_STATUS: SaleStatus = {
  live: false,
  loaded: 0,
  total: 0,
  complete: false,
  fetchedAtUtc: null,
  refreshing: false,
  error: null,
};

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function notify(state: SaleState): void {
  for (const listener of state.listeners) listener();
}

function applyPage(state: SaleState, page: PagedLots): void {
  const live = page.live;
  state.status = live
    ? {
        live: true,
        loaded: live.loaded,
        total: live.saleTotal,
        complete: live.complete,
        fetchedAtUtc: live.fetchedAtUtc,
        refreshing: live.refreshing,
        error: live.error,
      }
    : { ...EMPTY_STATUS, loaded: page.rows.length, total: page.rows.length, complete: true };
}

/** Re-read the whole sale (detail + every lot) — after a progressive load ends, or when a newer pull exists. */
async function reload(state: SaleState): Promise<PagedLots> {
  const [detail, paged] = await Promise.all([
    api.getCatalogue(state.id),
    api.getLots(state.id, { pageSize: LARGE_PAGE_SIZE }),
  ]);
  const entry = state.entry;
  if (entry) {
    entry.detail = detail;
    entry.sourceName = detail.sourceName;
    entry.lots = paged.rows;
  } else {
    state.entry = { id: state.id, sourceName: detail.sourceName, detail, lots: paged.rows };
  }
  applyPage(state, paged);
  return paged;
}

async function run(
  state: SaleState,
  resolveFirst: (e: SaleEntry) => void,
  resolveDone: (e: SaleEntry) => void
): Promise<void> {
  const paged = await reload(state);
  const entry = state.entry!;
  resolveFirst(entry);

  if (!paged.live || paged.live.complete) {
    resolveDone(entry);
    return;
  }

  // Progressive: the backend is still pulling the sale. Ask only for rows past what we hold.
  let raw = paged.live.loaded;
  let failures = 0;
  notify(state);
  for (;;) {
    await sleep(PROGRESS_POLL_MS);
    if (cache.get(state.id) !== state) return; // dropped or evicted — stop following it
    try {
      const next = await api.getLots(state.id, { after: raw, pageSize: LARGE_PAGE_SIZE });
      failures = 0;
      if (!next.live || next.live.complete) {
        // The sale is whole. Its final order and classification tiers differ from the partial
        // view, and the filter options now cover every lot — so take one clean copy.
        await reload(state);
        notify(state);
        resolveDone(state.entry!);
        return;
      }
      entry.lots = entry.lots.concat(next.rows);
      raw = next.live.loaded;
      applyPage(state, { ...next, rows: entry.lots });
      notify(state);
    } catch (err) {
      if (++failures >= MAX_POLL_FAILURES) throw err;
    }
  }
}

function start(id: string): SaleState {
  let resolveFirst!: (e: SaleEntry) => void;
  let rejectFirst!: (err: unknown) => void;
  let resolveDone!: (e: SaleEntry) => void;
  let rejectDone!: (err: unknown) => void;
  const first = new Promise<SaleEntry>((res, rej) => ((resolveFirst = res), (rejectFirst = rej)));
  const done = new Promise<SaleEntry>((res, rej) => ((resolveDone = res), (rejectDone = rej)));
  // Callers await whichever they need; a promise nobody awaits must not raise an unhandled rejection.
  first.catch(() => undefined);
  done.catch(() => undefined);

  const state: SaleState = {
    id,
    entry: null,
    status: EMPTY_STATUS,
    first,
    done,
    listeners: new Set(),
    watchTimer: null,
    reconciling: false,
  };
  run(state, resolveFirst, resolveDone).catch((err) => {
    // A failed load is never retained, so it can be retried on the next call.
    if (cache.get(id) === state) cache.delete(id);
    state.status = { ...state.status, error: err instanceof Error ? err.message : String(err) };
    notify(state);
    rejectFirst(err);
    rejectDone(err);
  });
  return state;
}

function getState(id: string): SaleState {
  const cached = cache.get(id);
  if (cached) {
    // LRU touch: re-insert at the newest position so it outlives colder entries.
    cache.delete(id);
    cache.set(id, cached);
    return cached;
  }
  const state = start(id);
  cache.set(id, state);
  if (cache.size > MAX_CACHED_SALES) {
    const oldest = cache.keys().next().value; // Map keeps insertion / touch order
    if (oldest !== undefined) dropSale(oldest);
  }
  return state;
}

function dropSale(id: string): void {
  const state = cache.get(id);
  if (state?.watchTimer) clearInterval(state.watchTimer);
  cache.delete(id);
}

/**
 * Load a sale (headers + all lots), served from memory once loaded. Re-selecting a sale,
 * pooling it into a multi-sale set, or moving between the Catalogue / Valuation / Worksheet
 * pages for the same sale all hit the cache instead of the network. Resolves when the WHOLE
 * sale is here — pages that can't work with a partial sale use this.
 */
export function loadSale(id: string): Promise<SaleEntry> {
  return getState(id).done;
}

/**
 * Like loadSale, but resolves as soon as the first rows exist. The returned entry keeps growing
 * (its `lots` array is replaced as rows arrive) — pair it with `subscribeSale` to re-render, and
 * `getSaleStatus` for progress.
 */
export function loadSaleProgressive(id: string): Promise<SaleEntry> {
  return getState(id).first;
}

/** The sale's entry if it has any rows yet — never starts a load. */
export function peekSale(id: string): SaleEntry | null {
  return cache.get(id)?.entry ?? null;
}

/** Load progress and freshness of a sale (an empty status when it isn't loading). */
export function getSaleStatus(id: string): SaleStatus {
  return cache.get(id)?.status ?? EMPTY_STATUS;
}

async function checkForNewerPull(state: SaleState): Promise<void> {
  const { status } = state;
  if (state.reconciling || !status.live || !status.complete || !status.fetchedAtUtc) return;
  if (document.visibilityState !== "visible") return;
  state.reconciling = true;
  try {
    const probe = await api.getLots(state.id, { pageSize: 1, knownVersion: status.fetchedAtUtc });
    if (probe.live?.unchanged) {
      // Same pull — but keep the "refreshing" hint current.
      if (probe.live.refreshing !== status.refreshing) {
        state.status = { ...status, refreshing: probe.live.refreshing };
        notify(state);
      }
      return;
    }
    await reload(state); // the backend re-pulled the sale: swap in the fresh rows
    notify(state);
  } catch {
    // A missed poll is harmless — the next one tries again.
  } finally {
    state.reconciling = false;
  }
}

/**
 * Be told when a sale's rows or status change (rows arriving, a newer pull swapped in). While at
 * least one listener is attached to a complete live sale, it is polled for newer pulls. Returns
 * the unsubscribe function.
 */
export function subscribeSale(id: string, listener: () => void): () => void {
  const state = cache.get(id);
  if (!state) return () => undefined;
  state.listeners.add(listener);
  if (!state.watchTimer) {
    state.watchTimer = setInterval(() => void checkForNewerPull(state), FRESHNESS_POLL_MS);
  }
  return () => {
    state.listeners.delete(listener);
    if (state.listeners.size === 0 && state.watchTimer) {
      clearInterval(state.watchTimer);
      state.watchTimer = null;
    }
  };
}

/**
 * Fold a saved lot into its cached sale in place, keeping the cache warm through per-lot
 * edits — no refetch needed, and a later load still reflects the change. A no-op when the
 * sale isn't cached.
 */
export function patchCachedLot(saleId: string, updated: Lot): void {
  const entry = cache.get(saleId)?.entry;
  if (!entry) return;
  const idx = entry.lots.findIndex((l) => l.id === updated.id);
  if (idx !== -1) entry.lots[idx] = updated;
}

/** Drop one sale — call after a bulk edit whose per-lot results aren't returned, so the
 *  next load refetches it fresh. */
export function invalidateSale(id: string): void {
  dropSale(id);
}

/** Drop every cached sale. */
export function invalidateAllSales(): void {
  for (const id of [...cache.keys()]) dropSale(id);
}
