"use client";

import Link from "next/link";
import type { ComponentType } from "react";

export interface RecentListEntry {
  key: string;
  label: string;
  sublabel?: string;
}

interface RecentListProps {
  title: string;
  icon: ComponentType<{ fontSize?: "small"; sx?: object }>;
  entries: RecentListEntry[];
  emptyLabel: string;
  viewAllHref: string;
}

/** A small "recent/pinned items" card — the same shape used for Recent Catalogues, Saved
 *  Reports and Saved Filters on the launchpad, all backed by real existing endpoints. */
export default function RecentList({ title, icon: Icon, entries, emptyLabel, viewAllHref }: RecentListProps) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-border p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <Icon fontSize="small" sx={{ color: "var(--liquor)" }} />
        <h3 className="font-display text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
          {title}
        </h3>
        <Link href={viewAllHref} className="ml-auto text-[11.5px] font-medium no-underline" style={{ color: "var(--text-muted)" }}>
          View all
        </Link>
      </div>
      {entries.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          {emptyLabel}
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {entries.map((e) => (
            <li key={e.key} className="min-w-0">
              <div className="text-[12.5px] font-medium truncate" style={{ color: "var(--text)" }}>
                {e.label}
              </div>
              {e.sublabel && (
                <div className="text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                  {e.sublabel}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
