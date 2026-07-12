"use client";

import "./agGridSetup";
import { formatCurrency } from "@/lib/format";
import type { ColumnMeta, Lot } from "@/types/api";
import { AgGridReact } from "ag-grid-react";
import type { ColDef, GridReadyEvent, ICellRendererParams, SelectionChangedEvent } from "ag-grid-community";
import { useEffect, useMemo, useRef } from "react";
import { ascGridTheme } from "./agGridTheme";

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
  onOpenTicket,
  onSelectionChanged,
  quickFilterText,
}: {
  lots: Lot[];
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  hiddenColumns: Set<string>;
  onOpenTicket: (lot: Lot) => void;
  onSelectionChanged: (lots: Lot[]) => void;
  quickFilterText?: string;
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
        minWidth: 130,
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
      colId: "openTicket",
      pinned: "right",
      width: 130,
      sortable: false,
      filter: false,
      cellRenderer: (p: ICellRendererParams) => {
        const lot = (p.data as { __lot: Lot }).__lot;
        return (
          <button
            onClick={() => onOpenTicket(lot)}
            className="border border-border rounded-full px-3 py-1 text-[11.5px] text-text hover:border-liquor hover:text-liquor bg-surface"
          >
            Open ticket →
          </button>
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

  const handleGridReady = (e: GridReadyEvent) => {
    e.api.sizeColumnsToFit();
  };

  // Re-fit whenever which columns are visible changes (sizeColumnsToFit only runs once on
  // ready otherwise, so newly shown/hidden columns would leave the same gap again).
  useEffect(() => {
    gridRef.current?.api?.sizeColumnsToFit();
  }, [columnDefs]);

  return (
    <div style={{ height: "64vh", width: "100%" }}>
      <AgGridReact
        ref={gridRef}
        theme={ascGridTheme}
        rowData={rowData}
        columnDefs={columnDefs}
        quickFilterText={quickFilterText}
        rowSelection={{ mode: "multiRow", checkboxes: true, headerCheckbox: true }}
        onSelectionChanged={handleSelectionChanged}
        onGridReady={handleGridReady}
        onGridSizeChanged={(e) => e.api.sizeColumnsToFit()}
        pagination
        paginationPageSize={50}
        paginationPageSizeSelector={[25, 50, 100, 250]}
        animateRows
        defaultColDef={{ sortable: true, filter: true, resizable: true, floatingFilter: true }}
      />
    </div>
  );
}
