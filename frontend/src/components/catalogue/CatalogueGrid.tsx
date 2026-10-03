"use client";

import { useFillHeight } from "@/components/shared/useFillHeight";
import "./agGridSetup";
import { CLASSIFICATION_COLOR, CLASSIFICATION_LABEL } from "@/lib/classificationBadge";
import { formatCurrency } from "@/lib/format";
import { SALE_COLUMN_HEADER } from "@/lib/multiSale";
import type { ColumnMeta, Lot } from "@/types/api";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ColumnVisibleEvent, ICellRendererParams } from "ag-grid-community";
import { memo, useEffect, useMemo, useRef } from "react";
import { ascGridTheme } from "./agGridTheme";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";

// Same colors as LotViewDialog and the Analytics distribution chart (frontend/src/lib/classification.ts)
// — only Unclassified's label/background differ here, for a denser look in the grid.
const CLASSIFICATION_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  SelectBest: { label: CLASSIFICATION_LABEL.SelectBest, ...CLASSIFICATION_COLOR.SelectBest },
  Best: { label: CLASSIFICATION_LABEL.Best, ...CLASSIFICATION_COLOR.Best },
  BelowBest: { label: CLASSIFICATION_LABEL.BelowBest, ...CLASSIFICATION_COLOR.BelowBest },
  Poor: { label: CLASSIFICATION_LABEL.Poor, ...CLASSIFICATION_COLOR.Poor },
  Unclassified: { label: "—", bg: "transparent", fg: CLASSIFICATION_COLOR.Unclassified.fg },
};

/** Every raw column comes through as a string (Lot.rawData is Dictionary<string,string>
 *  server-side), so a numeric column left to compare/sort on the raw string value sorts
 *  lexicographically — "980" outranks "3450" descending because '9' > '3' as characters.
 *  Parsing it to a real number here fixes sort, the built-in number filter, and any
 *  min/max comparison in one place; commas are stripped the same way the server's own
 *  decimal parsing does. */
/** The grid never gets shorter than this, however little room is left below the filters. */
const MIN_GRID_HEIGHT = 180;
/** Space kept between the grid's bottom edge (its scrollbar) and the bottom of the window. */
const GRID_COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareGridValues(valueA: unknown, valueB: unknown): number {
  if (valueA == null) return valueB == null ? 0 : -1;
  if (valueB == null) return 1;
  if (typeof valueA === "number" && typeof valueB === "number") return valueA - valueB;
  return GRID_COLLATOR.compare(String(valueA), String(valueB));
}

function parseNumericCell(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const num = parseFloat(String(raw).replace(/,/g, ""));
  return Number.isNaN(num) ? null : num;
}

function effectiveValuation(lot: Lot): number | null {
  const v = lot.valuation;
  if (!v) return null;
  if (v.valuationSingle !== null) return v.valuationSingle;
  if (v.valuationFrom !== null && v.valuationTo !== null) return (v.valuationFrom + v.valuationTo) / 2;
  return v.valuationFrom;
}

function CatalogueGrid({
  lots,
  headers,
  columnMeta,
  hiddenColumns,
  onHiddenColumnsChange,
  onViewLot,
  onEditLot,
}: {
  lots: Lot[];
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  hiddenColumns: Set<string>;
  /**
   * AG Grid's own header menu ("Choose Columns") lets a user hide/show columns straight
   * from the grid, bypassing the app's "Columns" button entirely. That toggle only lives
   * in the grid's internal column state — until this fires, the app's own `hiddenColumns`
   * never learns about it, so the next re-render (e.g. touching a filter) pushes the
   * *old* `hide` values back down through colDefs and silently undoes it. This mirrors
   * every visibility change back into the app's state so the two never disagree.
   */
  onHiddenColumnsChange: (next: Set<string>) => void;
  onViewLot: (lot: Lot) => void;
  onEditLot: (lot: Lot) => void;
}) {
  const gridRef = useRef<AgGridReact>(null);

  const rowData = useMemo(
    () => lots.map((lot) => ({ ...lot.rawData, __lot: lot })),
    [lots]
  );

  // Without a stable row id, AG Grid falls back to matching rows by array index across
  // `rowData` updates — every filter/sale-reload swaps in a new array, so index-based
  // matching treats every row as "changed" and re-evaluates the whole grid instead of
  // diffing by identity. Lot ids are already stable and unique, so this costs nothing and
  // lets AG Grid's own row-model do the cheap thing (keep scroll position/selection stable,
  // only re-render rows whose data actually changed).
  const getRowId = useMemo(() => (params: { data: { __lot: Lot } }) => params.data.__lot.id, []);

  // A fresh object literal here would change identity on every CatalogueGrid render (typing
  // in the search box re-renders the whole page), and AG Grid treats a new `defaultColDef`
  // reference as "the column configuration changed" — reprocessing every column even though
  // nothing in it actually did. Memoized once since these three flags never change.
  const defaultColDef = useMemo<ColDef>(
    () => ({
      sortable: true,
      sortingOrder: ["asc", "desc"],
      comparator: compareGridValues,
      filter: false,
      resizable: true,
      wrapHeaderText: true,
      autoHeaderHeight: true,
    }),
    []
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [];

    headers.forEach((h) => {
      const meta = columnMeta[h];
      // "Sale" is the synthetic column identifying each lot's sale in a multi-sale set —
      // pinned so it stays in view while scrolling wide catalogues, and never editable.
      const isSale = h === SALE_COLUMN_HEADER;
      cols.push({
        field: h,
        // The raw "Valuation" column is whichever broker's own published valuation for that lot (from OKLO) -
        // labeled to tell it apart from the app's own pinned Valuation column (ASC's own assessment) further right.
        headerName: h === "Valuation" ? "Broker Valuation" : h,
        hide: hiddenColumns.has(h),
        // agSetColumnFilter is AG Grid Enterprise-only — Community-only here, so
        // categorical columns fall back to the text filter (the app's own FilterPanel is
        // the primary multi-select filtering UI anyway).
        type: meta?.numeric ? "numericColumn" : undefined,
        // field stays wired for edits (they write back into rawData as text, same as
        // before); valueGetter overrides what sort/filter/display actually read.
        valueGetter: meta?.numeric ? (p) => parseNumericCell(p.data?.[h]) : undefined,
        minWidth: isSale ? 120 : 80,
        maxWidth: 260,
        tooltipField: h,
        editable: !isSale,
        ...(isSale && { pinned: "left" as const, cellClass: "font-semibold" }),
      });
    });

    cols.push({
      headerName: "Valuation",
      colId: "valuation",
      pinned: "right",
      width: 140,
      // Fixed width: sizeColumnsToFit must not squeeze these (their header/pills/buttons got clipped).
      suppressSizeToFit: true,
      wrapHeaderText: false,
      type: "numericColumn",
      valueGetter: (p) => effectiveValuation((p.data as { __lot: Lot }).__lot),
      valueFormatter: (p) => formatCurrency(p.value as number | null),
      cellClass: "font-mono",
    });

    cols.push({
      headerName: "Classification",
      colId: "classification",
      pinned: "right",
      width: 160,
      // Fixed width: sizeColumnsToFit must not squeeze these (their header/pills/buttons got clipped).
      suppressSizeToFit: true,
      wrapHeaderText: false,
      // No field/valueGetter here used to mean the inherited sortable/filter (from
      // defaultColDef) had no underlying value to work with — sorting this column did nothing
      // and its text filter matched nothing. The label text is what's actually shown, so sort
      // and filter work against the same words the user sees.
      valueGetter: (p) =>
        CLASSIFICATION_STYLE[(p.data as { __lot: Lot }).__lot.valuation?.classification ?? "Unclassified"].label,
      cellRenderer: (p: ICellRendererParams) => {
        const lot = (p.data as { __lot: Lot }).__lot;
        const cls = lot.valuation?.classification ?? "Unclassified";
        const style = CLASSIFICATION_STYLE[cls];
        return (
          <span
            className="inline-block px-2.5 py-0.5 rounded-full text-[10.5px] font-semibold"
            style={{ background: style.bg, color: style.fg }}
          >
            {style.label}
          </span>
        );
      },
    });

    cols.push({
      headerName: "",
      colId: "actions",
      pinned: "right",
      width: 96,
      // Fixed width: sizeColumnsToFit must not squeeze these (their header/pills/buttons got clipped).
      suppressSizeToFit: true,
      wrapHeaderText: false,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams) => {
        const lot = (p.data as { __lot: Lot }).__lot;
        return (
          <div className="flex items-center gap-1 h-full">
            <button
              title="View lot details"
              onClick={() => onViewLot(lot)}
              className="w-7 h-7 flex items-center justify-center rounded-full border border-border text-text-muted hover:border-liquor hover:text-liquor bg-surface"
            >
              <VisibilityOutlinedIcon sx={{ fontSize: 16 }} />
            </button>
            <button
              title="Edit valuation"
              onClick={() => onEditLot(lot)}
              className="w-7 h-7 flex items-center justify-center rounded-full border border-border text-text-muted hover:border-brass hover:text-liquor bg-surface"
            >
              <EditOutlinedIcon sx={{ fontSize: 16 }} />
            </button>
          </div>
        );
      },
    });

    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, columnMeta, hiddenColumns]);

  // Recomputes the full hidden-column set straight from the grid's own column state —
  // fires for every visibility change, however it happened (native header menu, "Reset
  // Columns", or our own colDef push), so the app's state always matches what's actually
  // on screen. Only tracks raw headers; the pinned Valuation/Classification/actions
  // columns aren't part of `hiddenColumns` and are never toggleable anyway.
  const handleColumnVisible = (e: ColumnVisibleEvent) => {
    const headerSet = new Set(headers);
    const next = new Set(
      e.api.getColumns()?.filter((c) => !c.isVisible() && headerSet.has(c.getColId())).map((c) => c.getColId()) ?? []
    );
    if (next.size === hiddenColumns.size && [...next].every((h) => hiddenColumns.has(h))) return;
    onHiddenColumnsChange(next);
  };

  // sizeColumnsToFit resizes every displayed (non-pinned) column proportionally so their total
  // width exactly equals the center viewport width — this is what makes the grid fill the full
  // page AND guarantees zero gap before the pinned Valuation/Classification/Actions columns
  // (unlike a fixed per-column width, which leaves a gap when there are too few columns to fill
  // the space). The per-column min/maxWidth above stop that stretch from making any single
  // column absurdly wide when only a few are visible.
  const fitColumns = () => gridRef.current?.api?.sizeColumnsToFit();

  const handleGridReady = () => fitColumns();

  useEffect(fitColumns, [columnDefs]);

  // Fill exactly the rest of the window, so the grid's own scrollbars are on screen and the page never scrolls.
  const { ref: wrapRef, height } = useFillHeight<HTMLDivElement>(MIN_GRID_HEIGHT);

  return (
    <div ref={wrapRef} style={{ height: height ?? "64vh", width: "100%" }}>
      <AgGridReact
        ref={gridRef}
        theme={ascGridTheme}
        rowData={rowData}
        getRowId={getRowId}
        columnDefs={columnDefs}
        onColumnVisible={handleColumnVisible}
        onGridReady={handleGridReady}
        onGridSizeChanged={fitColumns}
        animateRows={false}
        tooltipShowDelay={300}
        defaultColDef={defaultColDef}
      />
    </div>
  );
}

// Filter edits and search typing update the page shell, but the grid's inputs stay
// unchanged until Search is pressed. Skipping those parent renders avoids waking
// AG Grid (and rebuilding its React cell renderers) for work unrelated to the rows.
export default memo(CatalogueGrid);
