"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "next/link";
import { useState } from "react";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#about", label: "About" },
  { href: "#insights", label: "Insights" },
];

/**
 * Same sticky topbar shell the authenticated app shell uses (Topbar.tsx: `app-topbar`
 * padding, `border-b border-border bg-surface sticky top-0`, `--shadow-sm`) — this page is
 * the front door to that app, so it should read as the same product from the first pixel,
 * not a separate marketing site bolted on.
 */
export default function LandingNav() {
  const { user, loading } = useAuth();
  const { mode } = useThemeMode();
  const [menuOpen, setMenuOpen] = useState(false);

  const ctaHref = loading ? "/login" : user ? (user.roles.includes("Admin") ? "/admin" : "/dashboard") : "/login";
  const ctaLabel = loading ? "Sign In" : user ? (user.roles.includes("Admin") ? "Admin Panel" : "Dashboard") : "Sign In";

  return (
    <header
      className="app-topbar min-h-[68px] flex items-center gap-x-4 gap-y-2 flex-wrap border-b border-border bg-surface sticky top-0 z-30"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        <Link href="/home" className="shrink-0 flex items-center gap-2 no-underline">
          <BrandLogo height={30} onDark={mode === "dark"} />
          <span className="hidden lg:flex flex-col leading-none border-l border-border pl-2">
            <span className="font-mono text-[9.5px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Intelligent
            </span>
            <span className="font-mono text-[9.5px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Hub
            </span>
          </span>
        </Link>

        <nav className="hidden md:flex items-center gap-6" aria-label="Landing page sections">
          {LINKS.map((l) => (
            <a key={l.href} href={l.href} className="text-[13px] font-medium no-underline" style={{ color: "var(--text)" }}>
              {l.label}
            </a>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <Button component={Link} href={ctaHref} variant="contained" color="primary" size="small">
            {ctaLabel}
          </Button>
          <IconButton
            className="md:hidden"
            size="small"
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <CloseOutlinedIcon fontSize="small" /> : <MenuOutlinedIcon fontSize="small" />}
          </IconButton>
        </div>
      </div>

      {menuOpen && (
        <nav aria-label="Landing page sections (mobile)" className="md:hidden w-full flex flex-col gap-0.5 pt-1 pb-1">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="text-[13px] font-medium no-underline py-2.5 border-b border-border"
              style={{ color: "var(--text)" }}
            >
              {l.label}
            </a>
          ))}
        </nav>
      )}
    </header>
  );
}
