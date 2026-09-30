import { themeQuartz } from "ag-grid-community";

// A dedicated dark "auction floor" look for the Live Auction watch page - deliberately not tied to the app's own
// light/dark toggle (unlike ascGridTheme): this page is meant to read like a trading floor / broker portal screen,
// always dark, regardless of what theme the rest of the app is in.
export const auctionFloorGridTheme = themeQuartz.withParams({
  accentColor: "#5b8def",
  backgroundColor: "#12151c",
  foregroundColor: "#dfe6f2",
  chromeBackgroundColor: "#1a1f2b",
  headerTextColor: "#8b93a7",
  headerBackgroundColor: "#1a1f2b",
  headerFontSize: 11,
  headerFontWeight: 700,
  oddRowBackgroundColor: "#161b25",
  rowHoverColor: "#212838",
  borderColor: "#2a3140",
  columnBorder: { style: "solid", width: 1, color: "#242a37" },
  rowBorder: { style: "solid", width: 1, color: "#242a37" },
  fontFamily: "var(--font-body)",
  fontSize: 13,
  spacing: 6,
  wrapperBorderRadius: 10,
  headerHeight: 38,
  rowHeight: 36,
});
