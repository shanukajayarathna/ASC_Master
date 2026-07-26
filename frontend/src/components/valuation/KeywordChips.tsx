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
  fill,
}: {
  field: RemarkKeywordField;
  value: string;
  onToggle: (keyword: string) => void;
  disabled?: boolean;
  /** Fill the height the parent hands us (scrolling internally when a field lists more
   *  terms than fit) instead of sizing to content. Sizing to content isn't enough on a
   *  side-by-side row: a field with fewer terms would sit shorter than the rest and its
   *  remark box below would grow to fill the difference, so the boxes would come out
   *  uneven. The parent gives every card the same slot, so they all match (Focus mode). */
  fill?: boolean;
}) {
  const keywords = REMARK_KEYWORDS[field];
  if (!keywords.length) return null;
  return (
    <div
      className={`flex flex-wrap content-start gap-2 ${fill ? "h-full overflow-y-auto" : "mb-2"}`}
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
            className="px-3.5 py-2.5 rounded-lg text-[15px] font-semibold border-2 cursor-pointer touch-manipulation transition-all duration-100 active:scale-[0.95] shrink-0"
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
