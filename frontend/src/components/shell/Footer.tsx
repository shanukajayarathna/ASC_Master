"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { NAV_ITEMS, NAV_SECTIONS } from "./nav";
import Link from "next/link";
import { useMemo } from "react";

/**
 * Dashboard-only footer (rendered by both dashboard/page.tsx's UserDashboard and
 * AdminDashboard, not site-wide via Shell — the dashboard is the one page everyone lands on
 * and leaves from, so it's the natural home for a "find anything" nav strip without every
 * other page carrying it too).
 *
 * Several tiles have left the primary dashboard grid as the navigation gets consolidated
 * (Saved Filters, Data Import, Exports today; more will follow in later phases) without
 * being deleted — their pages/routes/APIs still work, they're just no longer a launchpad
 * tile. This footer is their (and everything else's) permanent secondary way back in, so
 * it deliberately groups and lists every NAV_ITEMS entry by its existing `section` — the
 * same field NAV_SECTIONS names but that no tile-rendering surface actually reads today —
 * rather than filtering by `hiddenFromGrid` like the dashboard grids do. Nothing here
 * should ever become unreachable just because it left the grid.
 *
 * Styled to read as a designed footer (brand mark, address, a brand-gradient top accent —
 * same `--rule-brand` token used elsewhere for a premium touch) rather than a bare list of
 * links, matching the LandingFooter pattern used on the public marketing page.
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
    <footer className="mt-8 rounded-t-[var(--radius-lg)] border border-b-0 border-border overflow-hidden" style={{ background: "var(--surface)" }}>
      <div className="h-1" style={{ background: "var(--rule-brand)" }} aria-hidden="true" />
      <div className="app-main-safe max-w-[1200px] mx-auto px-5 sm:px-8 py-10 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-8">
        <div className="col-span-2 sm:col-span-3 lg:col-span-1">
          <BrandLogo height={30} />
          <p className="text-[12px] leading-relaxed mt-3 mb-1 max-w-[220px]" style={{ color: "var(--text-muted)" }}>
            Asia Siyaka Commodities PLC
          </p>
          <p className="text-[12px] leading-relaxed m-0 max-w-[220px]" style={{ color: "var(--text-muted)" }}>
            Deutsche House, 320 T. B. Jayah Mawatha, Colombo 010, Sri Lanka
          </p>
        </div>
        {sections.map((group) => (
          <div key={group.section}>
            <h3
              className="font-display text-[11.5px] font-semibold uppercase tracking-wide m-0 mb-3 pb-1.5"
              style={{ color: "var(--liquor-dark)", borderBottom: "2px solid var(--liquor-light)", display: "inline-block" }}
            >
              {group.section}
            </h3>
            <ul className="list-none m-0 p-0 flex flex-col gap-2">
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
      <div className="text-center py-4 border-t border-border" style={{ background: "var(--surface-alt)" }}>
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
