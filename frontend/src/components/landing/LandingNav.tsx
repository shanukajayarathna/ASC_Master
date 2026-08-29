"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import CloseOutlinedIcon from "@mui/icons-material/CloseOutlined";
import MenuOutlinedIcon from "@mui/icons-material/MenuOutlined";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const LINKS = [
  { href: "#intelligence", label: "Platform" },
  { href: "#how-it-works", label: "How It Works" },
  { href: "#about", label: "About" },
  { href: "#insights", label: "Insights" },
];

/**
 * Same sticky topbar shell the authenticated app shell uses (Topbar.tsx: `app-topbar`
 * padding, `border-b border-border bg-surface sticky top-0`, `--shadow-sm`) — this page is
 * the front door to that app, so it should read as the same product from the first pixel,
 * not a separate marketing site bolted on.
 */
export default function LandingNav({ hasTestimonials = false }: { hasTestimonials?: boolean }) {
  const { user, loading } = useAuth();
  const { mode } = useThemeMode();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const headerRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Only shown once the Insights section (testimonials) actually exists on the page — the
  // seed data ships with every testimonial unpublished, so this is false by default and the
  // link would otherwise point at nothing.
  const links = hasTestimonials ? LINKS : LINKS.filter((l) => l.href !== "#insights");

  useEffect(() => {
    if (!menuOpen) return;
    const onKeyDown = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    const onClickOutside = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("mousedown", onClickOutside);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("mousedown", onClickOutside);
    };
  }, [menuOpen]);

  const ctaHref = loading ? "/login" : user ? (user.roles.includes("Admin") ? "/admin" : "/dashboard") : "/login";
  const ctaLabel = loading ? "Sign In" : user ? (user.roles.includes("Admin") ? "Admin Panel" : "Dashboard") : "Sign In";

  return (
    <header
      ref={headerRef}
      className="app-topbar landing-nav-scrolled min-h-[68px] flex items-center gap-x-4 gap-y-2 flex-wrap border-b border-border bg-surface sticky top-0 z-30"
      style={{ boxShadow: scrolled ? "var(--shadow-md)" : "var(--shadow-sm)" }}
    >
      <div className="max-w-7xl mx-auto w-full flex items-center justify-between">
        <Link href="/" className="shrink-0 flex items-center gap-2 no-underline">
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
          {links.map((l) => (
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
            sx={{ minWidth: 44, minHeight: 44 }}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="landing-nav-mobile-menu"
            onClick={() => setMenuOpen((v) => !v)}
          >
            {menuOpen ? <CloseOutlinedIcon fontSize="small" /> : <MenuOutlinedIcon fontSize="small" />}
          </IconButton>
        </div>
      </div>

      {menuOpen && (
        <nav id="landing-nav-mobile-menu" aria-label="Landing page sections (mobile)" className="md:hidden w-full flex flex-col gap-0.5 pt-1 pb-1">
          {links.map((l) => (
            <a
              key={l.href}
              href={l.href}
              onClick={() => setMenuOpen(false)}
              className="text-[13px] font-medium no-underline py-3 border-b border-border"
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
