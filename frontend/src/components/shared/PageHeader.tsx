"use client";

import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import Link from "next/link";
import type { ReactNode } from "react";

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

/**
 * The header every page hand-rolled slightly differently (and Catalogue Manager had none
 * at all) — now that there's no sidebar, a page needs to say what it is on its own. A "Back
 * to Home" pill replaces the wayfinding the sidebar used to provide implicitly. Pages nested
 * under a launchpad sub-section (e.g. Reports' tile pages) also get a `backTo` pill pointing
 * at that section, since Home alone would skip past it.
 */
export default function PageHeader({ title, subtitle, actions, backTo }: PageHeaderProps) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap print:hidden">
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
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
