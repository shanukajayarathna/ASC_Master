"use client";

import "./agGridSetup";
import { formatCurrency } from "@/lib/format";
import type { ColumnMeta, Lot } from "@/types/api";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, ICellRendererParams, SelectionChangedEvent } from "ag-grid-community";
import { useEffect, useMemo, useRef } from "react";
import { ascGridTheme } from "./agGridTheme";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";

const CLASSIFICATION_STYLE: Record<string, { label: string; bg: string; fg: string }> = {
  Best: { label: "Best", bg: "var(--sage-light)", fg: "var(--sage-dark)" },
  BelowBest: { label: "Below Best", bg: "var(--warn-light)", fg: "var(--warn)" },
  Poor: { label: "Poor", bg: "var(--danger-light)", fg: "var(--danger)" },
  Unclassified: { label: "—", bg: "transparent", fg: "var(--text-muted)" },
};

function effectiveValuation(lot: Lot): number | null {
  const v = lot.valuation;
  if (!v) return null;
  if (v.valuationSingle !== null) return v.valuationSingle;
  if (v.valuationFrom !== null && v.valuationTo !== null) return (v.valuationFrom + v.valuationTo) / 2;
  return v.valuationFrom;
}

export default function CatalogueGrid({
  lots,
  headers,
  columnMeta,
  hiddenColumns,
  onViewLot,
  onEditLot,
  onSelectionChanged,
}: {
  lots: Lot[];
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  hiddenColumns: Set<string>;
  onViewLot: (lot: Lot) => void;
  onEditLot: (lot: Lot) => void;
  onSelectionChanged: (lots: Lot[]) => void;
}) {
  const gridRef = useRef<AgGridReact>(null);

  const rowData = useMemo(
    () => lots.map((lot) => ({ ...lot.rawData, __lot: lot })),
    [lots]
  );

  const columnDefs = useMemo<ColDef[]>(() => {
    const cols: ColDef[] = [];

    headers.forEach((h) => {
      const meta = columnMeta[h];
      cols.push({
        field: h,
        headerName: h,
        hide: hiddenColumns.has(h),
        filter: meta?.categorical ? "agSetColumnFilter" : meta?.numeric ? "agNumberColumnFilter" : "agTextColumnFilter",
        type: meta?.numeric ? "numericColumn" : undefined,
        minWidth: 100,
        maxWidth: 260,
        tooltipField: h,
        editable: true,
      });
    });

    cols.push({
      headerName: "Valuation",
      colId: "valuation",
      pinned: "right",
      width: 130,
      type: "numericColumn",
      valueGetter: (p) => effectiveValuation((p.data as { __lot: Lot }).__lot),
      valueFormatter: (p) => formatCurrency(p.value as number | null),
      cellClass: "font-mono",
    });

    cols.push({
      headerName: "Classification",
      colId: "classification",
      pinned: "right",
      width: 130,
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
      width: 84,
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

  const handleSelectionChanged = (e: SelectionChangedEvent) => {
    const rows = e.api.getSelectedRows() as { __lot: Lot }[];
    onSelectionChanged(rows.map((r) => r.__lot));
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

  return (
    <div style={{ height: "64vh", width: "100%" }}>
      <AgGridReact
        ref={gridRef}
        theme={ascGridTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }}
        onSelectionChanged={handleSelectionChanged}
        onGridReady={handleGridReady}
        onGridSizeChanged={fitColumns}
        pagination
        paginationPageSize={50}
        paginationPageSizeSelector={[25, 50, 100, 250]}
        animateRows
        tooltipShowDelay={300}
        defaultColDef={{ sortable: true, filter: true, resizable: true }}
      />
    </div>
  );
}
