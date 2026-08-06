"use client";

import PriorityHighOutlinedIcon from "@mui/icons-material/PriorityHighOutlined";
import Link from "next/link";

export interface AttentionEntry {
  key: string;
  catalogueId: string;
  label: string;
  completionPercent: number;
  pending: number;
}

/**
 * Replaces the reference mockup's "Upcoming Deadlines" panel — this app has no task/
 * deadline/scheduling data anywhere (confirmed against the API), and showing fake due
 * dates and "Overdue" pills in a tool people run auction week from would be actively
 * misleading, not just an incomplete visual. Same "what needs my attention" intent, real
 * data instead: the recent sales with the lowest valuation-completion rate.
 */
export default function AttentionList({ entries, loading }: { entries: AttentionEntry[]; loading: boolean }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-border p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <PriorityHighOutlinedIcon fontSize="small" sx={{ color: "var(--liquor)" }} />
        <h3 className="font-display text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
          Sales Needing Attention
        </h3>
        <Link href="/catalogue" className="ml-auto text-[11.5px] font-medium no-underline" style={{ color: "var(--text-muted)" }}>
          View all
        </Link>
      </div>
      {loading ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          Checking completion across recent sales…
        </p>
      ) : entries.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          Every recent sale is fully valued.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2.5">
          {entries.map((e) => (
            <li key={e.key}>
              <Link
                href={`/valuation`}
                className="block no-underline"
                title={`${e.pending.toLocaleString()} lot${e.pending === 1 ? "" : "s"} still pending`}
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[12.5px] font-medium truncate" style={{ color: "var(--text)" }}>
                    {e.label}
                  </span>
                  <span className="text-[11px] font-mono shrink-0 ml-2" style={{ color: "var(--text-muted)" }}>
                    {Math.round(e.completionPercent)}%
                  </span>
                </div>
                <div className="h-1.5 rounded-full overflow-hidden" style={{ background: "var(--surface-sunken)" }}>
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.max(4, Math.round(e.completionPercent))}%`,
                      background: e.completionPercent < 50 ? "var(--warn)" : "var(--sage)",
                    }}
                  />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
