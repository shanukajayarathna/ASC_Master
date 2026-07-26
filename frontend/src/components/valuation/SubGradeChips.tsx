"use client";

import { CLASSIFICATIONS, SUB_GRADE_SUFFIXES, subGradeCode } from "@/lib/classifications";
import { subGradeCodeOf, withSubGrade } from "@/lib/subGrade";

/**
 * The 16 canonical sub-grade codes (4 tiers × 4 suffixes), grouped by tier. The Standard
 * field carries exactly one of them, so unlike the remark keyword chips this is
 * single-select: tapping a code replaces whatever was set, tapping the active one clears
 * it. Focus mode does the same job with the previous sale's price bands attached to each
 * button; this is the plain version for surfaces that have no band data to show.
 */
export default function SubGradeChips({
  value,
  onChange,
  disabled,
}: {
  /** The whole Standard field — the sub-grade is one token inside it. */
  value: string;
  /** Called with the rewritten Standard field, other tokens left untouched. */
  onChange: (next: string) => void;
  disabled?: boolean;
}) {
  const current = subGradeCodeOf(value);
  return (
    <div className="flex flex-col gap-1.5 mb-2" role="group" aria-label="Standard sub-grade">
      {CLASSIFICATIONS.map((c) => (
        <div key={c.value} className="flex items-center gap-1.5">
          <span className="font-mono text-[9.5px] tracking-widest uppercase text-text-muted w-[74px] shrink-0">
            {c.label}
          </span>
          {SUB_GRADE_SUFFIXES.map(({ suffix, label }) => {
            const code = subGradeCode(c.value, suffix);
            const active = current === code;
            return (
              <button
                key={suffix}
                type="button"
                disabled={disabled}
                title={active ? "Tap again to clear the sub-grade" : `${c.label} — ${label}`}
                onClick={() => onChange(withSubGrade(value, active ? null : code))}
                className="flex-1 px-2 py-1.5 rounded-md text-[12.5px] font-semibold font-mono border-[1.5px] cursor-pointer transition-colors disabled:cursor-not-allowed"
                style={{
                  borderColor: active ? c.color : "var(--border)",
                  background: active ? c.color : "var(--surface)",
                  color: active ? "var(--paper-0)" : "var(--text-muted)",
                }}
              >
                {code}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
