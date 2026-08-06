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
      <main className="flex-1 p-5 md:p-8 overflow-x-hidden">{children}</main>
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
