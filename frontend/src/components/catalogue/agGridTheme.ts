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
  headerFontWeight: 600,
  rowHoverColor: "var(--surface-alt)",
  selectedRowBackgroundColor: "var(--brass-dim)",
  fontFamily: "var(--font-body)",
  fontSize: 13,
  spacing: 6,
  wrapperBorderRadius: 6,
});
