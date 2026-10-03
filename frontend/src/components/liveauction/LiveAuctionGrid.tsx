"use client";

import { useFillHeight } from "@/components/shared/useFillHeight";
import type { Lot } from "@/types/api";
import { AgGridReact } from "ag-grid-react";
import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  EventApiModule,
  HighlightChangesModule,
  ModuleRegistry,
  RowApiModule,
  ScrollApiModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
  type ColDef,
} from "ag-grid-community";
import { useEffect, useMemo, useRef, useState } from "react";
import { auctionFloorGridTheme } from "./auctionFloorTheme";

// Registered directly here (not via the Catalogue Reports grid's shared agGridSetup.ts) so this grid's own module
// registration lives in the same bundle chunk as the component that needs it - this page is its own route, not a
// Catalogue Reports sub-page, and relying on a side-effect import from another route's chunk did not reliably run
// before this grid rendered (AG Grid's "error #200: module not registered" even though the shared file also lists
// these). Community-only, no Enterprise.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  TextFilterModule,
  TooltipModule,
  CellStyleModule,
  HighlightChangesModule,
  ColumnAutoSizeModule,
  ColumnApiModule,
  RowApiModule,
  ScrollApiModule,
  EventApiModule,
  ...(process.env.NODE_ENV !== "production" ? [ValidationModule] : []),
]);

const MIN_GRID_HEIGHT = 320;

function num(raw: string | undefined): number | null {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/,/g, ""));
  return Number.isNaN(n) ? null : n;
}

const STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  Sold: { bg: "rgba(52,199,89,0.18)", fg: "#4ade80" },
  Unsold: { bg: "rgba(248,113,113,0.18)", fg: "#f87171" },
  Outsold: { bg: "rgba(217,182,92,0.18)", fg: "#e0b84b" },
};

interface Row {
  id: string;
  lotNumber: string | null;
  broker: string | null;
  sellingMark: string | null;
  invoiceNo: string | null;
  grade: string | null;
  category: string | null;
  brokerValuation: string | null;
  askingPrice: number | null;
  registeredBid: number | null;
  highestBidder: string | null;
  secondBid: number | null;
  secondBidder: string | null;
  totalPrice: number | null;
  status: string;
  buyer: string;
}

function toRow(l: Lot): Row {
  return {
    id: l.id,
    lotNumber: l.lotNumber,
    broker: l.broker,
    sellingMark: l.rawData["Selling Mark"] ?? l.mark,
    invoiceNo: l.invoiceNo,
    grade: l.grade,
    category: l.category,
    brokerValuation: l.rawData["Valuation"] || null,
    askingPrice: num(l.rawData["Asking Price"]),
    registeredBid: num(l.rawData["Registered Bid"]),
    highestBidder: l.rawData["Highest Bidder"] || null,
    secondBid: num(l.rawData["Second Highest Bid"]),
    secondBidder: l.rawData["Second Highest Bidder"] || null,
    totalPrice: num(l.rawData["Total Price"]),
    status: l.rawData["Status"]?.trim() || "Pending",
    buyer: l.rawData["Buyer Name"] || l.rawData["Buyer"] || "",
  };
}

/** OKLO's own live-floor engine (the countdown timer, the running list of every bidder, Min/Limit/Standard/Shared Mark
 *  Price) is a separate, broker-only system this app's API access does not reach - see docs/31_OKLO_Live_Data.md. What
 *  this CAN honestly show: whichever lot's bid, price or status just changed between two polls, spotlighted the same
 *  way, with "updated Xs ago" in place of a countdown this app has no way to know. */
function mostRecentlyChanged(prev: Map<string, Row> | null, next: Row[]): Row | null {
  if (!prev) return null;
  let found: Row | null = null;
  for (const row of next) {
    const before = prev.get(row.id);
    if (
      before &&
      (before.registeredBid !== row.registeredBid ||
        before.secondBid !== row.secondBid ||
        before.status !== row.status ||
        before.totalPrice !== row.totalPrice)
    ) {
      found = row; // last match wins - good enough as "a" recently active lot, not a strict single truth
    }
  }
  return found;
}

/**
 * The bidding-relevant columns of one sale, live: asking price, current highest bid ("Registered Bid" - the field the
 * OKLO export names it), status and the settled buyer once a lot closes. `enableCellChangeFlash` gives each of those a
 * brief highlight when a poll brings back a changed value, so a real bid landing is visible at a glance, not just a
 * silently-updated number - the point of a "watch" view over the ordinary Catalogue Reports grid.
 */
export default function LiveAuctionGrid({ lots }: { lots: Lot[] }) {
  const gridRef = useRef<AgGridReact>(null);
  const { ref: wrapRef, height } = useFillHeight<HTMLDivElement>(MIN_GRID_HEIGHT);
  const prevRef = useRef<Map<string, Row> | null>(null);
  const [spotlight, setSpotlight] = useState<Row | null>(null);
  const [spotlightAt, setSpotlightAt] = useState<number | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const rowData = useMemo(() => lots.map(toRow), [lots]);

  useEffect(() => {
    const changed = mostRecentlyChanged(prevRef.current, rowData);
    if (changed) {
      setSpotlight(changed);
      setSpotlightAt(Date.now());
    }
    prevRef.current = new Map(rowData.map((r) => [r.id, r]));
  }, [rowData]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000); // keeps the "updated Xs ago" label live
    return () => clearInterval(t);
  }, []);

  const columnDefs = useMemo<ColDef[]>(
    () => [
      { field: "lotNumber", headerName: "Lot No", minWidth: 90, maxWidth: 110, pinned: "left" },
      { field: "broker", headerName: "Broker", minWidth: 90, maxWidth: 120 },
      { field: "sellingMark", headerName: "Selling Mark", minWidth: 130 },
      { field: "invoiceNo", headerName: "Invoice No", minWidth: 110 },
      { field: "grade", headerName: "Grade", minWidth: 90, maxWidth: 120 },
      { field: "category", headerName: "Category", minWidth: 110 },
      {
        field: "brokerValuation",
        headerName: "Broker Valuation",
        minWidth: 130,
        valueFormatter: (p) => (p.value ? p.value : "—"),
      },
      {
        field: "askingPrice",
        headerName: "Ask",
        type: "numericColumn",
        minWidth: 100,
        valueFormatter: (p) => (p.value == null ? "—" : p.value.toLocaleString()),
      },
      {
        field: "registeredBid",
        headerName: "Bid",
        type: "numericColumn",
        minWidth: 100,
        cellClass: "font-semibold",
        enableCellChangeFlash: true,
        valueFormatter: (p) => (p.value == null ? "—" : p.value.toLocaleString()),
      },
      { field: "highestBidder", headerName: "Highest Bidder", minWidth: 130, enableCellChangeFlash: true },
      {
        field: "secondBid",
        headerName: "2nd Bid",
        type: "numericColumn",
        minWidth: 100,
        enableCellChangeFlash: true,
        valueFormatter: (p) => (p.value == null ? "—" : p.value.toLocaleString()),
      },
      { field: "secondBidder", headerName: "2nd Bidder", minWidth: 130, enableCellChangeFlash: true },
      {
        field: "status",
        headerName: "Status",
        minWidth: 110,
        enableCellChangeFlash: true,
        cellRenderer: (p: { value: string }) => {
          const style = STATUS_STYLE[p.value];
          if (!style) return <span style={{ color: "#8b93a7" }}>{p.value}</span>;
          return (
            <span
              className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold"
              style={{ background: style.bg, color: style.fg }}
            >
              {p.value}
            </span>
          );
        },
      },
      {
        field: "totalPrice",
        headerName: "Total Price",
        type: "numericColumn",
        minWidth: 120,
        enableCellChangeFlash: true,
        valueFormatter: (p) => (p.value == null ? "—" : p.value.toLocaleString()),
      },
      { field: "buyer", headerName: "Buyer", minWidth: 140, enableCellChangeFlash: true },
    ],
    []
  );

  const defaultColDef = useMemo<ColDef>(() => ({ sortable: true, filter: true, resizable: true }), []);
  const getRowId = useMemo(() => (params: { data: { id: string } }) => params.data.id, []);

  const spotlightAgeS = spotlightAt && now ? Math.max(0, Math.floor((now - spotlightAt) / 1000)) : null;

  return (
    <div className="rounded-[10px] overflow-hidden" style={{ background: "#12151c", border: "1px solid #2a3140" }}>
      {spotlight && (
        <div className="px-4 py-3.5 border-b" style={{ borderColor: "#2a3140", background: "#1a1f2b" }}>
          <div className="flex items-center gap-2 mb-2.5">
            <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
            <span className="text-[11px] uppercase tracking-wide font-semibold" style={{ color: "#8b93a7" }}>
              Recently active
            </span>
            <span className="text-[11px] font-mono" style={{ color: "#5b8def" }}>
              lot {spotlight.lotNumber} · {spotlight.sellingMark}
            </span>
            <span className="text-[11px] font-mono ml-auto" style={{ color: "#8b93a7" }}>
              updated {spotlightAgeS}s ago
            </span>
          </div>
          {(spotlight.highestBidder || spotlight.secondBidder) && (
            <div className="mb-3">
              <div className="text-[10px] uppercase tracking-wide mb-1" style={{ color: "#8b93a7" }}>
                Bidders
              </div>
              <div className="flex items-center gap-1.5 flex-wrap">
                {spotlight.highestBidder && (
                  <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold" style={{ background: "#3b3315", color: "#e0b84b" }}>
                    {spotlight.highestBidder} - {spotlight.registeredBid?.toLocaleString() ?? "—"}
                  </span>
                )}
                {spotlight.secondBidder && (
                  <span className="px-2.5 py-1 rounded-full text-[12px] font-semibold" style={{ background: "#16321f", color: "#4ade80" }}>
                    {spotlight.secondBidder} - {spotlight.secondBid?.toLocaleString() ?? "—"}
                  </span>
                )}
              </div>
            </div>
          )}
          <div className="flex items-center gap-6 flex-wrap">
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b93a7" }}>
                Ask
              </div>
              <div className="text-[22px] font-bold" style={{ color: "#dfe6f2" }}>
                {spotlight.askingPrice?.toLocaleString() ?? "—"}
              </div>
            </div>
            <div className="px-3 py-1.5 rounded-lg border-2" style={{ borderColor: "#5b8def" }}>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b93a7" }}>
                Bid
              </div>
              <div className="text-[22px] font-bold" style={{ color: "#5b8def" }}>
                {spotlight.registeredBid?.toLocaleString() ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b93a7" }}>
                Status
              </div>
              <div className="text-[15px] font-semibold" style={{ color: STATUS_STYLE[spotlight.status]?.fg ?? "#dfe6f2" }}>
                {spotlight.status}
              </div>
            </div>
            {spotlight.buyer && (
              <div>
                <div className="text-[10px] uppercase tracking-wide" style={{ color: "#8b93a7" }}>
                  Buyer
                </div>
                <div className="text-[15px] font-semibold" style={{ color: "#dfe6f2" }}>
                  {spotlight.buyer}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
      <div ref={wrapRef} style={{ height: height ?? "60vh", width: "100%" }}>
        <AgGridReact
          ref={gridRef}
          theme={auctionFloorGridTheme}
          rowData={rowData}
          getRowId={getRowId}
          columnDefs={columnDefs}
          defaultColDef={defaultColDef}
          onGridReady={(e) => e.api.sizeColumnsToFit()}
          onGridSizeChanged={(e) => e.api.sizeColumnsToFit()}
          animateRows
        />
      </div>
    </div>
  );
}
