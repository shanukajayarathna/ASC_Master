import { SUB_GRADES } from "@/lib/classifications";

/**
 * The Standard field (`standardData`) is a comma-separated list of taster codes. Exactly one
 * of its tokens is the lot's sub-grade (SB++, B+, BB-, P--, …); everything else is free
 * standard notes. These helpers read and rewrite just that one token, leaving the rest be —
 * so the focus-view sub-grade picker and the Standard text box edit the same string without
 * fighting each other.
 */

// Longest codes first so "SB++" wins over "SB+", and "BB-" over "B-", on an exact-token match.
const CODES_BY_LENGTH = [...SUB_GRADES].sort((a, b) => b.code.length - a.code.length);
const CODE_SET = new Set(SUB_GRADES.map((c) => c.code.toLowerCase()));

function tokensOf(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/** The full sub-grade entry (tier + suffix + code) a Standard string holds, or null. */
export function subGradeEntryOf(standard: string | null | undefined) {
  const tokens = tokensOf(standard).map((t) => t.toLowerCase());
  for (const c of CODES_BY_LENGTH) {
    if (tokens.includes(c.code.toLowerCase())) return c;
  }
  return null;
}

/** The sub-grade code a Standard string holds, or null. */
export function subGradeCodeOf(standard: string | null | undefined): string | null {
  return subGradeEntryOf(standard)?.code ?? null;
}

/**
 * Replace whatever sub-grade token a Standard string holds with `code` (or drop it when
 * null), keeping every other token in place. A new code is placed first so the sub-grade
 * reads at the front of the Standard field.
 */
export function withSubGrade(standard: string | null | undefined, code: string | null): string {
  const kept = tokensOf(standard).filter((t) => !CODE_SET.has(t.toLowerCase()));
  if (code) kept.unshift(code);
  return kept.join(", ");
}
