"use client";

import { useAuth } from "@/context/AuthContext";
import { CatalogueProvider } from "@/context/CatalogueContext";
import Shell from "@/components/shell/Shell";
import CircularProgress from "@mui/material/CircularProgress";
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
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-surface-alt">
        <CircularProgress size={28} sx={{ color: "var(--liquor)" }} />
      </div>
    );
  }

  return (
    <CatalogueProvider>
      <Shell>{children}</Shell>
    </CatalogueProvider>
  );
}
