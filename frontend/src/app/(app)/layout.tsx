"use client";

import { useAuth } from "@/context/AuthContext";
import { CatalogueProvider } from "@/context/CatalogueContext";
import Shell from "@/components/shell/Shell";
import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useThemeMode } from "@/context/ThemeModeContext";
import { api } from "@/lib/api";
import { useRouter } from "next/navigation";
import { useEffect } from "react";

/**
 * Gates every real page behind login. Deliberately sits *outside* CatalogueProvider/Shell:
 * while signed out, nothing in this tree — no sidebar, no catalogue selector, no page
 * content — ever mounts, so there's no data to flash before the redirect lands.
 *
 * This is a UI gate only; the API endpoints these pages call are not yet auth-enforced
 * (see the Phase 2 auth commit) — closing that off server-side is a separate change.
 */
export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { mode } = useThemeMode();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Using the system is what keeps sale data fresh: ask the backend to re-pull stale recent/live
  // sales from OKLO on open, then every couple of minutes while the tab is in front. The call
  // returns at once and the backend rate-limits (a sale is only re-pulled if older than a
  // minute), so failures and repeats are harmless — hence the swallowed errors.
  const signedIn = !!user;
  useEffect(() => {
    if (!signedIn) return;
    // A page load / reload forces a fresh pull of the sales in use from OKLO (this layout stays mounted across in-app
    // navigation, so it runs once per full page load - the reload the user did).
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem("asc_active_catalogue");
    } catch {
      // Storage can be unavailable (private mode) - the backend still refreshes the newest sales.
    }
    void api.refreshOkloNow(stored ? [stored] : undefined).catch(() => undefined);
    const ping = () => {
      if (document.visibilityState === "visible") void api.refreshOkloData().catch(() => undefined);
    };
    ping();
    const timer = window.setInterval(ping, 2 * 60 * 1000);
    document.addEventListener("visibilitychange", ping);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", ping);
    };
  }, [signedIn]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-alt">
        <FullScreenLoader message="Preparing your workspace…" onDark={mode === "dark"} />
      </div>
    );
  }

  return (
    <CatalogueProvider>
      <Shell>{children}</Shell>
    </CatalogueProvider>
  );
}
