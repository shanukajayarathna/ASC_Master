"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Usually a string, but ReactNode so a page can bold/emphasize part of it (e.g. Valuation
   *  Centre's "values in **LKR**"). */
  subtitle?: ReactNode;
  /** Right-aligned slot for page-specific controls (pickers, buttons, …). */
  actions?: ReactNode;
  /** Extra "back to <section>" pill shown next to Home, for pages nested under a launchpad
   *  sub-section (e.g. Reports' tile pages) where Home alone skips a step. */
  backTo?: { href: string; label: string };
}

/** Styled as an actual button (border, background, real padding) rather than a caption-sized
 *  breadcrumb, since a plain muted text link at 11.5px read as decorative, not clickable (easy
 *  to miss, and a poor touch target on the tablets this app targets). */
function BackPill({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-full border border-border text-[12.5px] font-semibold no-underline transition-colors hover:border-[var(--liquor)] hover:text-[var(--liquor)]"
      style={{ color: "var(--text)", background: "var(--surface)" }}
    >
      <ArrowBackIcon sx={{ fontSize: 15 }} />
      {label}
    </Link>
  );
}

/** Appears once the page has scrolled a bit, docked centered on the sticky header's bottom
 *  edge — one click/tap back to the top instead of a long manual scroll or swipe-up. */
function ScrollToTopButton() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => setVisible(window.scrollY > 320);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      type="button"
      onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
      aria-label="Scroll to top"
      title="Scroll to top"
      className="absolute left-1/2 -translate-x-1/2 -bottom-4 flex items-center justify-center w-8 h-8 rounded-full border border-border cursor-pointer print:hidden"
      style={{ background: "var(--surface)", color: "var(--text)", boxShadow: "var(--shadow-sm)" }}
    >
      <ArrowUpwardIcon sx={{ fontSize: 16 }} />
    </button>
  );
}

/**
 * The header every page hand-rolled slightly differently (and Catalogue Manager had none
 * at all) — now that there's no sidebar, a page needs to say what it is on its own. A "Back
 * to Home" pill replaces the wayfinding the sidebar used to provide implicitly. Pages nested
 * under a launchpad sub-section (e.g. Reports' tile pages) also get a `backTo` pill pointing
 * at that section, since Home alone would skip past it.
 *
 * Sticky under the topbar (whose own height is published as --topbar-height, since it wraps
 * to a second row on narrow viewports) so the title and back/Home pills stay reachable while
 * scrolling a long page, instead of scrolling away with the content below them.
 */
export default function PageHeader({ title, subtitle, actions, backTo }: PageHeaderProps) {
  return (
    <div
      className="sticky z-10 mb-5 pt-4 pb-3 flex items-center justify-between gap-3 flex-wrap print:hidden border-b border-border"
      style={{ top: "var(--topbar-height, 68px)", background: "var(--surface-alt)" }}
    >
      <div>
        <div className="flex items-center gap-2 mb-2">
          {backTo && <BackPill href={backTo.href} label={backTo.label} />}
          <BackPill href="/dashboard" label="Home" />
        </div>
        <h1 className="font-display text-2xl font-bold m-0 mb-1" style={{ color: "var(--text-strong)" }}>
          {title}
        </h1>
        {subtitle && (
          <p className="text-[13px] m-0 max-w-xl" style={{ color: "var(--text-muted)" }}>
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      <ScrollToTopButton />
    </div>
  );
}
