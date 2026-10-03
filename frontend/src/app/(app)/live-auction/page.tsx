"use client";

import LiveAuctionGrid from "@/components/liveauction/LiveAuctionGrid";
import PageHeader from "@/components/shared/PageHeader";
import SalePicker from "@/components/shared/SalePicker";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { Lot } from "@/types/api";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import RefreshIcon from "@mui/icons-material/Refresh";
import Button from "@mui/material/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/** One category sub-catalogue within the sale (e.g. "Leafy", "Off Grade", "Dust" - OKLO's own AuctionName for each is
 *  "<sale> - <category>", matching the breakdown its own broker portal shows). OKLO does not give us that sub-catalogue's
 *  own Live/Ended/Paused flag through this API - it is inferred here from the lots we already have: still Pending lots
 *  mean it hasn't finished, and any Sold/Unsold among them means it has started. */
interface CategoryRow {
  name: string;
  lots: number;
  sold: number;
  unsold: number;
  pending: number;
  status: "Not started" | "In progress" | "Ended";
}

function categorize(lots: Lot[]): CategoryRow[] {
  const byName = new Map<string, { lots: number; sold: number; unsold: number; pending: number }>();
  for (const l of lots) {
    const name = l.category?.trim() || "Uncategorised";
    const row = byName.get(name) ?? { lots: 0, sold: 0, unsold: 0, pending: 0 };
    row.lots++;
    const status = l.rawData["Status"]?.trim();
    // "Outsold" (sold outside the floor auction, not via a live bid) is still a FINAL status,
    // same as LiveAuctionGrid's own styling treats it — counting it as "pending" instead used
    // to mean a category whose lots were all Sold/Outsold never showed "Ended" and its Pending
    // count never reached 0.
    if (status === "Sold" || status === "Outsold") row.sold++;
    else if (status === "Unsold") row.unsold++;
    else row.pending++;
    byName.set(name, row);
  }
  return Array.from(byName.entries())
    .map(([name, r]) => ({
      name,
      ...r,
      status: (r.pending === 0 ? "Ended" : r.sold + r.unsold > 0 ? "In progress" : "Not started") as CategoryRow["status"],
    }))
    .sort((a, b) => b.lots - a.lots);
}

const CATEGORY_STATUS_STYLE: Record<CategoryRow["status"], { bg: string; fg: string }> = {
  "In progress": { bg: "var(--danger-light, #fde3e3)", fg: "var(--danger, #b3261e)" },
  Ended: { bg: "var(--surface-sunken)", fg: "var(--text-muted)" },
  "Not started": { bg: "var(--brass-dim)", fg: "var(--brass-dark, #8a6a1f)" },
};

// Only the sale OKLO itself reports as open for bidding right now is worth re-pulling this often; any other sale picked
// here is either not yet open (nothing to watch changing) or already finished (final - see docs/31_OKLO_Live_Data.md),
// so it is loaded once and left alone rather than hammering OKLO for a sale that cannot change. 15s (not longer) so the
// spotlighted "recently active" lot in LiveAuctionGrid feels reasonably current; polling faster than OKLO's own
// ForceRefreshMinSeconds floor (60s) would not get newer data any sooner, just re-read the same cache more often.
const POLL_SECONDS = 15;

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const s = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function LiveAuctionPage() {
  const { catalogues } = useCatalogue();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [openCatalogueId, setOpenCatalogueId] = useState<string | null>(null); // whichever sale OKLO says is open right now
  const [initializing, setInitializing] = useState(true);
  const [loadingLots, setLoadingLots] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lots, setLots] = useState<Lot[] | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const tickTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [, forceTick] = useState(0);
  const loadSeq = useRef(0);

  const picked = catalogues.find((c) => c.id === pickedId) ?? null;
  const isTheOpenSale = !!pickedId && pickedId === openCatalogueId;

  const pull = useCallback(async (id: string, forceOkloRefresh: boolean) => {
    const seq = ++loadSeq.current;
    setRefreshing(true);
    try {
      if (forceOkloRefresh) await api.refreshOkloNow([id]);
      const res = await api.searchLots(id, { search: "", columnFilters: {}, status: "", classification: "", year: "", limit: 20000, offset: 0 });
      if (seq !== loadSeq.current) return; // a newer pick superseded this one
      setLots(res.rows as unknown as Lot[]);
      setUpdatedAt(new Date().toISOString());
      setError(null);
    } catch (e) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : "Could not load this sale");
    } finally {
      if (seq === loadSeq.current) setLoadingLots(false);
      setRefreshing(false);
    }
  }, []);

  // On open, find whichever sale OKLO reports as open right now and start on it - the reason this page exists. The
  // picker then lets a person watch any other catalogue instead, live-open or not.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const info = await api.getLiveSale();
        if (cancelled) return;
        setOpenCatalogueId(info.catalogueId);
        if (info.catalogueId) setPickedId(info.catalogueId);
      } catch {
        // No live-sale signal available - the picker still works; just nothing is pre-selected.
      } finally {
        if (!cancelled) setInitializing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!pickedId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLots(null);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoadingLots(true);
    setLots(null);
    setSelectedCategory(null);
    void pull(pickedId, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickedId]);

  useEffect(() => {
    if (pollTimer.current) clearInterval(pollTimer.current);
    if (pickedId && isTheOpenSale) {
      pollTimer.current = setInterval(() => void pull(pickedId, true), POLL_SECONDS * 1000);
    }
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, [pickedId, isTheOpenSale, pull]);

  useEffect(() => {
    tickTimer.current = setInterval(() => forceTick((n) => n + 1), 1000); // keeps the "updated Xs ago" label live
    return () => {
      if (tickTimer.current) clearInterval(tickTimer.current);
    };
  }, []);

  const categories = useMemo(() => (lots ? categorize(lots) : []), [lots]);
  const visibleLots = useMemo(
    () => (selectedCategory ? (lots ?? []).filter((l) => (l.category?.trim() || "Uncategorised") === selectedCategory) : lots ?? []),
    [lots, selectedCategory]
  );
  const sold = visibleLots.filter((l) => l.rawData["Status"]?.trim() === "Sold").length;
  const unsold = visibleLots.filter((l) => l.rawData["Status"]?.trim() === "Unsold").length;

  return (
    <div>
      <PageHeader
        title="Live Auction"
        subtitle={
          picked && isTheOpenSale ? (
            <span className="inline-flex items-center gap-1.5">
              <RadioButtonCheckedIcon sx={{ fontSize: 14, color: "var(--danger, #b3261e)" }} className="animate-pulse" />
              <span className="font-semibold" style={{ color: "var(--text-strong)" }}>
                {picked.sourceName}
              </span>
              <span>is open for bidding right now — watch bids and status update live.</span>
            </span>
          ) : picked ? (
            `${picked.sourceName} isn't open for bidding on OKLO right now — showing its current data.`
          ) : (
            "Pick a catalogue to watch its bids and lot status."
          )
        }
        actions={
          <span className="flex items-center gap-2.5 flex-wrap justify-end">
            <SalePicker value={pickedId} onChange={setPickedId} className="flex gap-1.5" />
            {pickedId && (
              <>
                <span className="text-[12px] text-text-muted font-mono">
                  {refreshing ? "Updating…" : updatedAt ? `Updated ${timeAgo(updatedAt)}` : ""}
                </span>
                <Button
                  size="small"
                  variant="outlined"
                  startIcon={<RefreshIcon fontSize="small" />}
                  disabled={refreshing}
                  onClick={() => void pull(pickedId, true)}
                >
                  Refresh now
                </Button>
              </>
            )}
          </span>
        }
      />

      {initializing && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {!initializing && error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      {!initializing && !pickedId && (
        <div
          className="border border-dashed border-border rounded-[var(--radius-lg)] bg-surface flex items-center justify-center text-center px-6"
          style={{ minHeight: "42vh" }}
        >
          <p className="text-[13.5px] text-text-muted m-0 max-w-md">
            No sale is open for bidding on OKLO right now. Pick a catalogue above to review its lots, or come back once
            the next auction starts.
          </p>
        </div>
      )}

      {!initializing && pickedId && loadingLots && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {!initializing && pickedId && !loadingLots && lots && !selectedCategory && (
        <div className="border border-border rounded-[var(--radius-lg)] bg-surface overflow-hidden mb-4">
          <div className="px-4 py-3 border-b border-border flex items-center justify-between">
            <h3 className="font-display text-[14px] font-semibold text-text m-0">Catalogues in this sale</h3>
            <span className="text-[12px] text-text-muted font-mono">{lots.length.toLocaleString()} lots total</span>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-text-muted" style={{ background: "var(--surface-sunken)" }}>
                <th className="px-4 py-2 font-semibold">Name</th>
                <th className="px-4 py-2 font-semibold">Status</th>
                <th className="px-4 py-2 font-semibold text-right">Lots</th>
                <th className="px-4 py-2 font-semibold text-right">Sold</th>
                <th className="px-4 py-2 font-semibold text-right">Unsold</th>
                <th className="px-4 py-2 font-semibold text-right">Pending</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody>
              {categories.map((c, i) => {
                const style = CATEGORY_STATUS_STYLE[c.status];
                return (
                  <tr
                    key={c.name}
                    className="cursor-pointer hover:bg-surface-alt transition-colors"
                    style={{ background: i % 2 ? "var(--surface-sunken)" : undefined }}
                    onClick={() => setSelectedCategory(c.name)}
                  >
                    <td className="px-4 py-2.5 font-medium">
                      {picked?.sourceName ?? "Sale"} - {c.name}
                    </td>
                    <td className="px-4 py-2.5">
                      <span
                        className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold"
                        style={{ background: style.bg, color: style.fg }}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono">{c.lots.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--success-dark, #1c6b34)" }}>
                      {c.sold.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono" style={{ color: "var(--danger, #b3261e)" }}>
                      {c.unsold.toLocaleString()}
                    </td>
                    <td className="px-4 py-2.5 text-right font-mono text-text-muted">{c.pending.toLocaleString()}</td>
                    <td className="px-4 py-2.5 text-right">
                      <Button size="small" variant="contained">
                        View
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {!initializing && pickedId && !loadingLots && lots && selectedCategory && (
        <>
          <div className="flex items-center gap-2 mb-3 flex-wrap">
            <span className="text-[13px] font-semibold" style={{ color: "var(--text-strong)" }}>
              {picked?.sourceName} - {selectedCategory}
            </span>
            <Button size="small" variant="outlined" startIcon={<ArrowBackIcon fontSize="small" />} onClick={() => setSelectedCategory(null)}>
              All catalogues
            </Button>
            <span className="text-[12.5px] font-mono px-2.5 py-1 rounded-full border border-border bg-surface">
              {visibleLots.length.toLocaleString()} lots
            </span>
            <span
              className="text-[12.5px] font-mono px-2.5 py-1 rounded-full border"
              style={{ borderColor: "var(--success-dark, #1c6b34)", color: "var(--success-dark, #1c6b34)" }}
            >
              {sold.toLocaleString()} sold
            </span>
            <span
              className="text-[12.5px] font-mono px-2.5 py-1 rounded-full border"
              style={{ borderColor: "var(--danger, #b3261e)", color: "var(--danger, #b3261e)" }}
            >
              {unsold.toLocaleString()} unsold
            </span>
          </div>
          <LiveAuctionGrid lots={visibleLots} />
        </>
      )}
    </div>
  );
}
