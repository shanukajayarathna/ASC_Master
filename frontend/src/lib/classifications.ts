import type { ClassificationValue } from "@/types/api";

// The four quality tiers, in rank order. `key` is the keyboard shortcut used by both the
// Valuation Centre grid and its focus view; `short` is the compact label for dense strips.
export const CLASSIFICATIONS: { value: ClassificationValue; label: string; short: string; key: string; color: string }[] = [
  { value: "SelectBest", label: "Select Best", short: "SB", key: "1", color: "var(--brass)" },
  { value: "Best", label: "Best", short: "B", key: "2", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", short: "BB", key: "3", color: "var(--warn)" },
  { value: "Poor", label: "Poor", short: "P", key: "4", color: "var(--danger)" },
];
