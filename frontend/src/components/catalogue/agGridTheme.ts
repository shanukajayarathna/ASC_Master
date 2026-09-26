import { themeQuartz } from "ag-grid-community";

// AG Grid v36 Theming API accepts live CSS custom properties as color values,
// so this automatically follows our light/dark [data-theme] toggle in globals.css
// without needing two separate theme objects.
export const ascGridTheme = themeQuartz.withParams({
  accentColor: "var(--brass)",
  backgroundColor: "var(--surface)",
  foregroundColor: "var(--text)",
  borderColor: "var(--border)",
  chromeBackgroundColor: "var(--surface-sunken)",
  headerTextColor: "var(--text)",
  rowHoverColor: "var(--surface-alt)",
  selectedRowBackgroundColor: "var(--brass-dim)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  spacing: 6,
  wrapperBorderRadius: 6,
  // A plain ruled table: a line between every column and every row, and a distinct header band, so the eye can follow a
  // lot straight across and each column reads as its own field.
  columnBorder: { style: "solid", width: 1, color: "var(--border)" },
  rowBorder: { style: "solid", width: 1, color: "var(--border)" },
  headerColumnBorder: { style: "solid", width: 1, color: "var(--border)" },
  headerRowBorder: { style: "solid", width: 1, color: "var(--border)" },
  headerBackgroundColor: "var(--surface-sunken)",
  headerFontSize: 13,
  headerFontWeight: 700,
  headerHeight: 42,
  rowHeight: 38,
});
