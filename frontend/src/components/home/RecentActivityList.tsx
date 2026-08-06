"use client";

import type { SvgIconComponent } from "@mui/icons-material";
import Link from "next/link";

export interface ActivityEntry {
  key: string;
  icon: SvgIconComponent;
  iconColor: string;
  iconBg: string;
  title: string;
  subtitle: string;
  timestamp: string;
  href: string;
}

/**
 * A real merged timeline — catalogue imports, saved reports and AI conversations, each
 * already fetched elsewhere on this page, sorted together by date. Deliberately doesn't
 * show per-lot events ("Photo uploaded — Lot 0897" style): there's no endpoint that can
 * answer "which lots changed recently across the whole app," and fetching full lot lists
 * client-side just to sort by edit time would be the kind of expensive bulk-fetch the
 * earlier performance pass specifically avoided.
 */
export default function RecentActivityList({ entries }: { entries: ActivityEntry[] }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-border p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <h3 className="font-display text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
          Recent Activity
        </h3>
      </div>
      {entries.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          Nothing yet — import a sale, save a report or ask the AI Assistant something.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-3">
          {entries.map((e) => {
            const Icon = e.icon;
            return (
              <li key={e.key}>
                <Link href={e.href} className="flex items-start gap-2.5 no-underline">
                  <span
                    className="w-7 h-7 rounded-full flex items-center justify-center shrink-0"
                    style={{ background: e.iconBg }}
                  >
                    <Icon sx={{ fontSize: 15, color: e.iconColor }} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium truncate" style={{ color: "var(--text)" }}>
                      {e.title}
                    </span>
                    <span className="block text-[11px] truncate" style={{ color: "var(--text-muted)" }}>
                      {e.subtitle}
                    </span>
                  </span>
                  <span className="text-[10.5px] shrink-0 whitespace-nowrap" style={{ color: "var(--text-muted)" }}>
                    {e.timestamp}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
