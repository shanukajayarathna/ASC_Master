import { createTheme } from "@mui/material/styles";
import { darkTokens, lightTokens } from "./tokens";

export function buildTheme(mode: "light" | "dark") {
  const t = mode === "dark" ? darkTokens : lightTokens;
  return createTheme({
    palette: {
      mode,
      primary: { main: t.brass, dark: t.liquorDark, contrastText: t.ink900 },
      secondary: { main: t.liquor },
      error: { main: t.danger },
      success: { main: t.sage },
      background: { default: t.paper50, paper: t.paper0 },
      text: { primary: t.ink800, secondary: t.inkMuted },
      divider: t.line,
    },
    typography: {
      fontFamily: "var(--font-body), sans-serif",
      h1: { fontFamily: "var(--font-display), serif" },
      h2: { fontFamily: "var(--font-display), serif" },
      h3: { fontFamily: "var(--font-display), serif" },
      h4: { fontFamily: "var(--font-display), serif" },
      button: { textTransform: "none", fontWeight: 600 },
    },
    shape: { borderRadius: 6 },
    components: {
      MuiButton: { styleOverrides: { root: { borderRadius: 6 } } },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: "none" } },
      },
    },
  });
}
