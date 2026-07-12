"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Mode = "light" | "dark";

interface ThemeModeCtx {
  mode: Mode;
  toggle: () => void;
}

const Ctx = createContext<ThemeModeCtx | null>(null);

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    // Reads browser-only APIs (localStorage/matchMedia) after mount so the client's
    // first render matches the server's, then syncs the real preference in — this is
    // the standard SSR-safe pattern, not the derived-state anti-pattern the rule targets.
    const stored = window.localStorage.getItem("asc_theme_mode") as Mode | null;
    const preferred = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMode(stored ?? preferred);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
    window.localStorage.setItem("asc_theme_mode", mode);
  }, [mode]);

  const value = useMemo<ThemeModeCtx>(
    () => ({ mode, toggle: () => setMode((m) => (m === "light" ? "dark" : "light")) }),
    [mode]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
}
