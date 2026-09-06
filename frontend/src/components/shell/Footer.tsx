"use client";

import { useAuth } from "@/context/AuthContext";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav";
import Link from "next/link";
import { useMemo } from "react";

/**
 * Site-wide footer, rendered once by Shell so it appears under every authenticated page.
 *
 * Several tiles have left the primary dashboard grid as the navigation gets consolidated
 * (Saved Filters, Data Import, Exports today; more will follow in later phases) without
 * being deleted — their pages/routes/APIs still work, they're just no longer a launchpad
 * tile. This footer is their (and everything else's) permanent secondary way back in, so
 * it deliberately groups and lists every NAV_ITEMS entry by its existing `section` — the
 * same field NAV_SECTIONS names but that no tile-rendering surface actually reads today —
 * rather than filtering by `hiddenFromGrid` like the dashboard grids do. Nothing here
 * should ever become unreachable just because it left the grid.
 */
export default function Footer() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;

  const sections = useMemo(() => {
    return NAV_SECTIONS.map((section) => ({
      section,
      items: NAV_ITEMS.filter((item) => item.section === section && (!item.adminOnly || isAdmin)),
    })).filter((group) => group.items.length > 0);
  }, [isAdmin]);

  return (
    <footer className="border-t border-border mt-8" style={{ background: "var(--surface)" }}>
      <div className="app-main-safe max-w-[1200px] mx-auto px-4 py-8 grid gap-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}>
        {sections.map((group) => (
          <div key={group.section}>
            <h3 className="font-display text-[12px] font-semibold uppercase tracking-wide m-0 mb-2.5" style={{ color: "var(--text-muted)" }}>
              {group.section}
            </h3>
            <ul className="list-none m-0 p-0 flex flex-col gap-1.5">
              {group.items.map((item) => (
                <li key={item.href}>
                  <Link href={item.href} className="text-[13px] no-underline hover:underline" style={{ color: "var(--text)" }}>
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="text-center border-t border-border py-4">
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          ASC — Tea Auction Valuation &amp; Business Intelligence Platform
        </p>
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          © {new Date().getFullYear()} Asia Siyaka Commodities PLC. All rights reserved.
        </p>
      </div>
    </footer>
  );
}
