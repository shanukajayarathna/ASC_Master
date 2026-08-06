"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";

type Mode = "light" | "dark";
/** What the user actually chose — "system" tracks the OS preference live. */
type Preference = Mode | "system";

interface ThemeModeCtx {
  /** The resolved light/dark value — every existing consumer (MUI theme, icon choice,
   *  BrandLogo's onDark filter, …) keeps reading this unchanged regardless of preference. */
  mode: Mode;
  /** What's actually selected — "system" is only ever seen here, never in `mode`. */
  preference: Preference;
  /** Cycles Light → Dark → System → Light, for a single toggle control. */
  toggle: () => void;
  setPreference: (p: Preference) => void;
}

const Ctx = createContext<ThemeModeCtx | null>(null);

function systemPrefersDark() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function ThemeModeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] = useState<Preference>("light");
  const [mode, setMode] = useState<Mode>("light");

  useEffect(() => {
    // Reads browser-only APIs (localStorage/matchMedia) after mount so the client's
    // first render matches the server's, then syncs the real preference in — this is
    // the standard SSR-safe pattern, not the derived-state anti-pattern the rule targets.
    const stored = window.localStorage.getItem("asc_theme_mode") as Preference | null;
    const initial = stored ?? "system";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPreferenceState(initial);
    setMode(initial === "system" ? (systemPrefersDark() ? "dark" : "light") : initial);
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = mode;
  }, [mode]);

  // While "system" is selected, follow OS changes live instead of only reading them once.
  useEffect(() => {
    if (preference !== "system") return;
    const mql = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => setMode(mql.matches ? "dark" : "light");
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, [preference]);

  const setPreference = (p: Preference) => {
    setPreferenceState(p);
    window.localStorage.setItem("asc_theme_mode", p);
    setMode(p === "system" ? (systemPrefersDark() ? "dark" : "light") : p);
  };

  const value = useMemo<ThemeModeCtx>(
    () => ({
      mode,
      preference,
      toggle: () => setPreference(preference === "light" ? "dark" : preference === "dark" ? "system" : "light"),
      setPreference,
    }),
    [mode, preference]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useThemeMode() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useThemeMode must be used within ThemeModeProvider");
  return ctx;
}
