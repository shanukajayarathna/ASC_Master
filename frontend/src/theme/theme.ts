import { createTheme } from "@mui/material/styles";
import { DROPDOWN_MAX_ROWS, DROPDOWN_ROW_PX, SELECT_ROW_PX } from "@/components/shared/DropdownList";
import { darkTokens, lightTokens } from "./tokens";

export function buildTheme(mode: "light" | "dark") {
  const t = mode === "dark" ? darkTokens : lightTokens;
  return createTheme({
    palette: {
      mode,
      // contrastText must stay dark ink in BOTH modes: dark-mode ink900 flips to light
      // cream, which is unreadable on the light-gold dark-mode brass. Dark-mode paper0
      // is the same dark ink as light-mode ink900, so this pins it correctly.
      primary: { main: t.brass, dark: t.liquorDark, contrastText: mode === "dark" ? t.paper0 : t.ink900 },
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
    // Soft-premium radius instead of the old flat-enterprise 6px — MuiButton gets fully
    // rounded (pill) since that's the launchpad redesign's button language; everything
    // else (Paper, Select, TextField, …) picks up the 14px base from `shape.borderRadius`.
    shape: { borderRadius: 14 },
    components: {
      MuiButton: { styleOverrides: { root: { borderRadius: 999 } } },
      MuiPaper: {
        styleOverrides: { root: { backgroundImage: "none" } },
      },
      // Dropdowns, everywhere (see components/shared/DropdownList.tsx): they open below their field, show
      // every option, and cap at DROPDOWN_MAX_ROWS rows with a scrollbar for the rest. A component that
      // passes its own MenuProps / slotProps still wins.
      MuiSelect: {
        defaultProps: {
          MenuProps: {
            anchorOrigin: { vertical: "bottom", horizontal: "left" },
            transformOrigin: { vertical: "top", horizontal: "left" },
            // By class, because Select supplies its own paper props which a paper override would lose to.
            // 16 = the list's own top/bottom padding.
            sx: { "& .MuiMenu-paper": { maxHeight: SELECT_ROW_PX * DROPDOWN_MAX_ROWS + 16, marginTop: "4px" } },
          },
        },
      },
      MuiAutocomplete: {
        defaultProps: {
          // Fixed below the field: no flip to the top of it.
          slotProps: { popper: { placement: "bottom-start", modifiers: [{ name: "flip", enabled: false }] } },
        },
        // Six rows in view, the rest by scrolling. (Very long lists opt in to a virtual list - see PickAutocomplete.)
        styleOverrides: { listbox: { maxHeight: DROPDOWN_ROW_PX * DROPDOWN_MAX_ROWS + 8 } },
      },
    },
  });
}
