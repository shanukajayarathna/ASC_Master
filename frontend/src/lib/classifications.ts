import type { ClassificationValue } from "@/types/api";

// The four quality tiers, in rank order. `key` is the keyboard shortcut used by both the
// Valuation Centre grid and its focus view.
export const CLASSIFICATIONS: { value: ClassificationValue; label: string; key: string; color: string }[] = [
  { value: "SelectBest", label: "Select Best", key: "1", color: "var(--brass)" },
  { value: "Best", label: "Best", key: "2", color: "var(--sage)" },
  { value: "BelowBest", label: "Below Best", key: "3", color: "var(--warn)" },
  { value: "Poor", label: "Poor", key: "4", color: "var(--danger)" },
];
