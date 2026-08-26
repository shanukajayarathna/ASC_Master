"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";

const LINKS = [
  { href: "#platform", label: "Platform" },
  { href: "#intelligence", label: "Intelligence" },
  { href: "#about", label: "About" },
  { href: "#insights", label: "Insights" },
];

/**
 * Transparent over the hero, solid on scroll. The CTA reflects session state without ever
 * force-redirecting a logged-in visitor away from the marketing page (spec 4.5) — it just
 * swaps the button's destination: Admin -> /admin, any other role -> /dashboard, signed out
 * -> /login.
 */
export default function LandingNav() {
  const { user, loading } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 24);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const ctaHref = loading ? "/login" : user ? (user.roles.includes("Admin") ? "/admin" : "/dashboard") : "/login";
  const ctaLabel = loading ? "Sign In" : user ? (user.roles.includes("Admin") ? "Go to Admin Panel" : "Go to Dashboard") : "Sign In";

  return (
    <header
      className="fixed top-0 inset-x-0 z-50 transition-colors duration-300"
      style={{
        background: scrolled ? "var(--tea-ink)" : "transparent",
        borderBottom: scrolled ? "1px solid rgba(244,241,230,0.1)" : "1px solid transparent",
      }}
    >
      <div className="max-w-7xl mx-auto px-5 sm:px-8 h-16 sm:h-20 flex items-center justify-between">
        <a href="#top" className="inline-flex items-center gap-2 no-underline">
          <BrandLogo height={30} onDark />
          <span className="hidden sm:inline font-mono text-[10px] tracking-[0.2em] uppercase" style={{ color: "var(--tea-ledger)", opacity: 0.75 }}>
            Intelligent Hub
          </span>
        </a>

        <nav className="hidden md:flex items-center gap-7" aria-label="Landing page sections">
          {LINKS.map((l) => (
            <a
              key={l.href}
              href={l.href}
              className="no-underline font-mono text-[11px] tracking-[0.14em] uppercase transition-opacity hover:opacity-70"
              style={{ color: "var(--tea-ledger)" }}
            >
              {l.label}
            </a>
          ))}
        </nav>

        <a
          href={ctaHref}
          className="no-underline inline-flex items-center px-4 sm:px-5 py-2 rounded-full text-[13px] font-semibold transition-transform hover:-translate-y-0.5"
          style={{ background: "var(--tea-liquor)", color: "var(--tea-ink)" }}
        >
          {ctaLabel}
        </a>
      </div>
    </header>
  );
}
