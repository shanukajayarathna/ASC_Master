"use client";

import { hasKeyword, REMARK_KEYWORDS, type RemarkKeywordField } from "@/lib/remarkKeywords";

/**
 * The clickable master-keyword cards shown on a remark field — tap one to add it to the
 * field (or remove it, if it's already there). Same reference list the field's
 * "Standard Data" / "Adjective Data" / "Liquor Remarks" / "Remarks" sheets define, so
 * every editing surface for a lot offers the identical set of terms. Takes the spot the
 * field's placeholder examples used to occupy — the cards are the examples now.
 */
export default function KeywordChips({
  field,
  value,
  onToggle,
  disabled,
  fixedHeight,
}: {
  field: RemarkKeywordField;
  value: string;
  onToggle: (keyword: string) => void;
  disabled?: boolean;
  /** Pins the card area to an exact height (scrolling internally if a field lists more
   *  terms than fit) instead of sizing to content — a *cap* alone isn't enough, because a
   *  field with fewer terms would then sit shorter than the rest and its remark box below
   *  would grow to fill the difference. Every box needs the identical amount of space
   *  taken here so the boxes come out the same size (e.g. Focus mode's side-by-side row). */
  fixedHeight?: number;
}) {
  const keywords = REMARK_KEYWORDS[field];
  if (!keywords.length) return null;
  return (
    <div
      className="flex flex-wrap content-start gap-2 mb-2"
      style={fixedHeight ? { height: fixedHeight, overflowY: "auto" } : undefined}
      role="group"
      aria-label="Tap a term to add it"
    >
      {keywords.map((k) => {
        const active = hasKeyword(value, k.code);
        return (
          <button
            key={k.code}
            type="button"
            disabled={disabled}
            title={k.description}
            onClick={() => onToggle(k.code)}
            className="px-3.5 py-2.5 rounded-lg text-[14px] font-semibold border-2 cursor-pointer touch-manipulation transition-all duration-100 active:scale-[0.95]"
            style={{
              borderColor: active ? "var(--liquor)" : "var(--border)",
              background: active ? "var(--liquor)" : "var(--surface)",
              color: active ? "var(--paper-0)" : "var(--text)",
              boxShadow: active ? "0 2px 6px rgba(0,0,0,0.22)" : "none",
              transform: active ? "translateY(-1px)" : "none",
            }}
          >
            {active ? "✓ " : ""}
            {k.code}
          </button>
        );
      })}
    </div>
  );
}
