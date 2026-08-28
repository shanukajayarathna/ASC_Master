"use client";

import { AUTH_TOKEN_STORAGE_KEY, api, setAuthToken, setUnauthorizedHandler } from "@/lib/api";
import type { AuthUser } from "@/types/api";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

const TOKEN_KEY = AUTH_TOKEN_STORAGE_KEY;

interface AuthCtx {
  user: AuthUser | null;
  /** True only while the stored token (if any) is being validated on first load — lets
   *  callers avoid flashing a "logged out" state before that check has finished. */
  loading: boolean;
  login: (email: string, password: string) => Promise<AuthUser>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = window.localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    setAuthToken(stored);
    (async () => {
      try {
        setUser(await api.me());
      } catch {
        // Stored token is expired/invalid — drop it rather than keep retrying every render.
        window.localStorage.removeItem(TOKEN_KEY);
        setAuthToken(null);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password);
    window.localStorage.setItem(TOKEN_KEY, res.token);
    setAuthToken(res.token);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    window.localStorage.removeItem(TOKEN_KEY);
    setAuthToken(null);
    setUser(null);
  }, []);

  // A 401 anywhere in the app (lib/api.ts) means the server has already invalidated this
  // token — clear our own state to match rather than let `user` keep claiming a session the
  // backend no longer honors.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Browsers can restore a fully-rendered previous page from the back/forward cache instead
  // of re-running this provider's mount effect — `pageshow` with `persisted: true` is the one
  // reliable signal that happened. Re-validating the token on that signal is defense in depth
  // alongside the public-pages' own force-logout-on-entry check (useForceLogoutOnPublicPage):
  // that check only covers landing/login specifically, this covers a bfcache restore of *any*
  // page, including one that never went through those.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      const stored = window.localStorage.getItem(TOKEN_KEY);
      if (!stored) {
        setUser(null);
        return;
      }
      setAuthToken(stored);
      api.me().then(setUser).catch(logout);
    };
    window.addEventListener("pageshow", onPageShow);
    return () => window.removeEventListener("pageshow", onPageShow);
  }, [logout]);

  const value = useMemo<AuthCtx>(() => ({ user, loading, login, logout }), [user, loading, login, logout]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
