"use client";

import { useEffect, useState } from "react";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";

const COLLAPSED_KEY = "asc:sidebar:collapsed";

export default function Shell({ children }: { children: React.ReactNode }) {
  // Desktop: collapsed hides the sidebar entirely (hamburger brings it back).
  // Mobile (< md): the sidebar is an overlay drawer toggled by the same hamburger.
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  // Restore the persisted preference after mount so SSR markup stays deterministic.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1");
  }, []);

  const toggleSidebar = () => {
    if (window.matchMedia("(min-width: 768px)").matches) {
      setCollapsed((c) => {
        window.localStorage.setItem(COLLAPSED_KEY, c ? "0" : "1");
        return !c;
      });
    } else {
      setMobileOpen((o) => !o);
    }
  };

  return (
    <div className="flex min-h-screen bg-surface-alt">
      <Sidebar collapsed={collapsed} mobileOpen={mobileOpen} onClose={() => setMobileOpen(false)} />
      <div className="flex-1 flex flex-col min-w-0">
        <Topbar sidebarCollapsed={collapsed} onMenuClick={toggleSidebar} />
        <main className="flex-1 p-5 md:p-8 overflow-x-hidden">{children}</main>
      </div>
    </div>
  );
}
