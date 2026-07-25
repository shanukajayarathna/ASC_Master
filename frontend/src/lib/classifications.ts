import type { ClassificationValue } from "@/types/api";

// The four quality tiers, in rank order. `key` is the keyboard shortcut used by both the
// Valuation Centre grid and its focus view; `short` is the compact label for dense strips.
export const CLASSIFICATIONS: { value: ClassificationValue; label: string; short: string; key: string; color: string }[] = [
  { value: "SelectBest", label: "Select Best", short: "SB", key: "1", color: "var(--brass)" },
  { value: "Best", label: "Best", short: "B", key: "2", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", short: "BB", key: "3", color: "var(--warn)" },
  { value: "Poor", label: "Poor", short: "P", key: "4", color: "var(--danger)" },
];

/** A tier is split into four sub-grades, best to worst: ++ (top), + (upper), - (lower), -- (bottom). */
export type SubGradeSuffix = "++" | "+" | "-" | "--";

export const SUB_GRADE_SUFFIXES: { suffix: SubGradeSuffix; label: string }[] = [
  { suffix: "++", label: "Top" },
  { suffix: "+", label: "Upper" },
  { suffix: "-", label: "Lower" },
  { suffix: "--", label: "Bottom" },
];

/** The code a tier + suffix carries in the Standard field, e.g. Best + "+" → "B+", SelectBest + "++" → "SB++". */
export function subGradeCode(tier: ClassificationValue, suffix: SubGradeSuffix): string {
  const short = CLASSIFICATIONS.find((c) => c.value === tier)?.short ?? "";
  return `${short}${suffix}`;
}

/** All 16 canonical sub-grade codes (4 tiers × 4 suffixes) with the tier they belong to. */
export const SUB_GRADES: { tier: ClassificationValue; suffix: SubGradeSuffix; code: string }[] =
  CLASSIFICATIONS.flatMap((c) =>
    SUB_GRADE_SUFFIXES.map((s) => ({ tier: c.value, suffix: s.suffix, code: `${c.short}${s.suffix}` }))
  );
