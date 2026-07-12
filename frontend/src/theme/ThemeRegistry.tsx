"use client";

import { AppRouterCacheProvider } from "@mui/material-nextjs/v16-appRouter";
import CssBaseline from "@mui/material/CssBaseline";
import { ThemeProvider } from "@mui/material/styles";
import { ThemeModeProvider, useThemeMode } from "@/context/ThemeModeContext";
import { buildTheme } from "./theme";
import { useMemo } from "react";

function MuiThemeBridge({ children }: { children: React.ReactNode }) {
  const { mode } = useThemeMode();
  const theme = useMemo(() => buildTheme(mode), [mode]);
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {children}
    </ThemeProvider>
  );
}

export default function ThemeRegistry({ children }: { children: React.ReactNode }) {
  return (
    <AppRouterCacheProvider options={{ key: "mui" }}>
      <ThemeModeProvider>
        <MuiThemeBridge>{children}</MuiThemeBridge>
      </ThemeModeProvider>
    </AppRouterCacheProvider>
  );
}
