"use client";

import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Link from "next/link";
import type { ReactNode } from "react";

interface PageHeaderProps {
  title: string;
  /** Usually a string, but ReactNode so a page can bold/emphasize part of it (e.g. Valuation
   *  Centre's "values in **LKR**"). */
  subtitle?: ReactNode;
  /** Right-aligned slot for page-specific controls (pickers, buttons, …). */
  actions?: ReactNode;
}

/**
 * The header every page hand-rolled slightly differently (and Catalogue Manager had none
 * at all) — now that there's no sidebar, a page needs to say what it is on its own. A small
 * "Home" breadcrumb replaces the wayfinding the sidebar used to provide implicitly.
 */
export default function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3 flex-wrap print:hidden">
      <div>
        <Link
          href="/dashboard"
          className="inline-flex items-center gap-0.5 text-[11.5px] font-medium mb-1 no-underline"
          style={{ color: "var(--text-muted)" }}
        >
          Home
          <ChevronRightIcon sx={{ fontSize: 13 }} />
        </Link>
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
