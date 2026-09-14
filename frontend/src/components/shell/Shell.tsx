"use client";

import { useEffect, useState } from "react";
import CommandPalette from "./CommandPalette";
import Topbar from "./Topbar";

/** Sidebar-free shell: a single top bar (brand, search/command-palette, catalogue picker,
 *  theme, AI, account) plus the page itself. Navigation between modules now happens via the
 *  launchpad home page's tile grid or the command palette, not a persistent side nav. */
export default function Shell({ children }: { children: React.ReactNode }) {
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-surface-alt">
      <Topbar onSearchClick={() => setPaletteOpen(true)} />
      {/* Side/bottom paddings live in .app-main-safe (globals.css) so they can fold in the
          display-cutout safe-area insets; only the top padding stays a plain utility.
          `overflow-x: clip` (via style, not the Tailwind `overflow-x-hidden` class) clips
          full-bleed content horizontally without also making `main` a scroll container —
          `overflow: hidden` on either axis does that per spec, which broke PageHeader's
          `position: sticky` by making its offset resolve against `main`'s box instead of
          the real viewport. */}
      <main className="app-main-safe flex-1 pt-5 md:pt-8" style={{ overflowX: "clip" }}>
        {children}
      </main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
