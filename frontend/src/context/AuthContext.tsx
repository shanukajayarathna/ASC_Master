"use client";

import { SESSION_HINT_KEY, api, setSessionActive, setUnauthorizedHandler } from "@/lib/api";
import type { AuthUser } from "@/types/api";
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

// The login token itself is an HttpOnly cookie the browser manages; the only thing kept in localStorage is a non-secret
// hint that a session probably exists. An older build kept the real token here - remove any left over.
const LEGACY_TOKEN_KEY = "asc_auth_token";

interface AuthCtx {
  user: AuthUser | null;
  /** True only while the session (if any) is being validated on first load — lets
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
    try {
      window.localStorage.removeItem(LEGACY_TOKEN_KEY);
    } catch {
      // Storage unavailable - nothing to clean.
    }
    if (window.localStorage.getItem(SESSION_HINT_KEY) !== "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLoading(false);
      return;
    }
    (async () => {
      try {
        const me = await api.me();
        setSessionActive(true);
        setUser(me);
      } catch {
        // The session cookie is expired/invalid/missing - forget the hint rather than retry on every load.
        window.localStorage.removeItem(SESSION_HINT_KEY);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.login(email, password); // the API sets the HttpOnly session cookie
    window.localStorage.setItem(SESSION_HINT_KEY, "1");
    setSessionActive(true);
    setUser(res.user);
    return res.user;
  }, []);

  const logout = useCallback(() => {
    // Only the server can remove an HttpOnly cookie. Local state is cleared at once; the call is best-effort.
    window.localStorage.removeItem(SESSION_HINT_KEY);
    setSessionActive(false);
    setUser(null);
    api.logout().catch(() => {});
  }, []);

  // A 401 anywhere in the app (lib/api.ts) means the server has already invalidated this session - clear our own state
  // to match rather than let `user` keep claiming a session the backend no longer honors.
  useEffect(() => {
    setUnauthorizedHandler(logout);
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Browsers can restore a fully-rendered previous page from the back/forward cache instead of re-running this
  // provider's mount effect - `pageshow` with `persisted: true` is the one reliable signal that happened. Re-validating
  // the session on that signal is defense in depth alongside the public pages' own force-logout-on-entry check.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      if (window.localStorage.getItem(SESSION_HINT_KEY) !== "1") {
        setUser(null);
        return;
      }
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
