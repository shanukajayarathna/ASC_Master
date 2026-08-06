"use client";

import LightbulbOutlinedIcon from "@mui/icons-material/LightbulbOutlined";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import Link from "next/link";

export interface Insight {
  key: string;
  /** "up"/"down" tint the icon chip — sage for a positive move, warn for a negative one,
   *  neutral (brass) when the number alone doesn't imply good/bad. */
  tone: "up" | "down" | "neutral";
  text: string;
}

const TONE_BG: Record<Insight["tone"], string> = {
  up: "var(--sage-light)",
  down: "var(--warn-light)",
  neutral: "var(--brass-dim)",
};
const TONE_FG: Record<Insight["tone"], string> = {
  up: "var(--sage-dark)",
  down: "var(--warn)",
  neutral: "var(--liquor)",
};

/**
 * Real, computed insights — grade-level valuation swings and classification-mix shifts
 * versus the previous sale (see dashboard/page.tsx for the computation, which reuses the
 * same Analytics endpoints and previous-sale logic Analysis/Valuation Centre already use).
 * Never decorative/predictive text with no data behind it.
 */
export default function AiInsightsPanel({ insights, loading }: { insights: Insight[]; loading: boolean }) {
  return (
    <div
      className="rounded-[var(--radius-lg)] border border-border p-4"
      style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
    >
      <div className="flex items-center gap-2 mb-3">
        <LightbulbOutlinedIcon fontSize="small" sx={{ color: "var(--liquor)" }} />
        <h3 className="font-display text-[13.5px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
          AI Insights
        </h3>
      </div>

      {loading ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          Comparing against the previous sale…
        </p>
      ) : insights.length === 0 ? (
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          Not enough history yet — insights appear once there&apos;s a previous sale to compare against.
        </p>
      ) : (
        <ul className="m-0 p-0 list-none flex flex-col gap-2 mb-3">
          {insights.map((i) => (
            <li
              key={i.key}
              className="flex items-start gap-2 px-3 py-2 rounded-[var(--radius-md)]"
              style={{ background: TONE_BG[i.tone] }}
            >
              <span className="text-[12.5px] leading-snug flex-1" style={{ color: TONE_FG[i.tone] }}>
                {i.text}
              </span>
              <ChevronRightIcon sx={{ fontSize: 16, color: TONE_FG[i.tone] }} />
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-center justify-between pt-2 border-t border-border">
        <Link href="/assistant" className="text-[11.5px] font-medium no-underline" style={{ color: "var(--text-muted)" }}>
          Ask AI a question
        </Link>
        <Link href="/assistant" className="text-[11.5px] font-medium no-underline" style={{ color: "var(--liquor)" }}>
          Open Assistant →
        </Link>
      </div>
    </div>
  );
}
