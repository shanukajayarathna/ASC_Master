import {
  CellStyleModule,
  ClientSideRowModelModule,
  ColumnApiModule,
  ColumnAutoSizeModule,
  EventApiModule,
  ModuleRegistry,
  NumberEditorModule,
  NumberFilterModule,
  PaginationModule,
  RowApiModule,
  RowSelectionModule,
  RowStyleModule,
  ScrollApiModule,
  TextEditorModule,
  TextFilterModule,
  TooltipModule,
  ValidationModule,
} from "ag-grid-community";

// Community-only: no AG Grid Enterprise (unlicensed anyway — it only ever showed a
// watermark) and no "All*Module" bundles, just the specific features CatalogueGrid.tsx
// actually uses (client-side rows, text/number filters+editors, pagination, checkbox row
// selection, tooltips, column auto-size for sizeColumnsToFit). ValidationModule is
// dev-only — it logs a clear console error naming any feature used without its module
// registered, which is how this list should be extended if the grid grows.
ModuleRegistry.registerModules([
  ClientSideRowModelModule,
  TextFilterModule,
  NumberFilterModule,
  TextEditorModule,
  NumberEditorModule,
  RowSelectionModule,
  PaginationModule,
  TooltipModule,
  CellStyleModule,
  RowStyleModule,
  ColumnAutoSizeModule,
  ColumnApiModule,
  RowApiModule,
  ScrollApiModule,
  EventApiModule,
  ...(process.env.NODE_ENV !== "production" ? [ValidationModule] : []),
]);
