// Single source of truth for valuation-entry rules, shared by the Valuation Centre,
// the Valuation drawer, and anything else that accepts a typed valuation.
//
// Business rules (mirrored server-side in LotsController.UpdateValuation):
//  - A valuation is always a whole 4-digit LKR value: 1000–9999.
//  - A range is two 4-digit values where the first is strictly lower than the second.

export const VALUATION_MIN = 1000;
export const VALUATION_MAX = 9999;

export const VALUATION_RULE_HINT = `4-digit value (${VALUATION_MIN}–${VALUATION_MAX})`;

export type ParsedValuation =
  | { kind: "clear" }
  | { kind: "single"; value: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "error"; message: string };

/** Validates one standalone value; returns an error message or null if OK. */
export function valuationValueError(value: number): string | null {
  if (!Number.isInteger(value)) return `Whole numbers only — e.g. ${VALUATION_MIN + 200}`;
  if (value < VALUATION_MIN || value > VALUATION_MAX)
    return `Must be a 4-digit value (${VALUATION_MIN}–${VALUATION_MAX})`;
  return null;
}

/**
 * Auto-detects whether the typed text is a single LKR value ("1200") or a range
 * ("1200-1350") — a dash between two numbers always means a range here since valuations
 * are never negative, so there's no ambiguity with a minus sign.
 */
export function parseValuationInput(raw: string): ParsedValuation {
  const trimmed = raw.trim().replace(/,/g, "");
  if (trimmed === "") return { kind: "clear" };

  const rangeMatch = trimmed.match(/^(\d+(?:\.\d+)?)\s*(?:-|to)\s*(\d+(?:\.\d+)?)$/i);
  if (rangeMatch) {
    const from = Number(rangeMatch[1]);
    const to = Number(rangeMatch[2]);
    const fromError = valuationValueError(from);
    if (fromError) return { kind: "error", message: fromError };
    const toError = valuationValueError(to);
    if (toError) return { kind: "error", message: toError };
    if (from >= to) return { kind: "error", message: "First number must be lower than the second" };
    return { kind: "range", from, to };
  }

  const singleMatch = trimmed.match(/^\d+(?:\.\d+)?$/);
  if (singleMatch) {
    const value = Number(trimmed);
    const valueError = valuationValueError(value);
    if (valueError) return { kind: "error", message: valueError };
    return { kind: "single", value };
  }

  return { kind: "error", message: `Numbers only — e.g. 1200 or 1200-1350` };
}

/**
 * Friendly live feedback while the user is still typing. Never shouts: a half-typed
 * value ("12") gets a neutral hint, not a red error — red is reserved for an explicit
 * save attempt (use parseValuationInput at commit time for that).
 */
export function valuationTypingFeedback(
  raw: string
): { tone: "ok" | "hint" | "none"; message: string } {
  const trimmed = raw.trim();
  if (trimmed === "") return { tone: "none", message: "" };

  const parsed = parseValuationInput(trimmed);
  if (parsed.kind === "single")
    return { tone: "ok", message: `Single value · Rs. ${parsed.value.toLocaleString()} — press Enter to save` };
  if (parsed.kind === "range")
    return {
      tone: "ok",
      message: `Range · Rs. ${parsed.from.toLocaleString()} – ${parsed.to.toLocaleString()} — press Enter to save`,
    };
  if (parsed.kind === "error") return { tone: "hint", message: parsed.message };
  return { tone: "none", message: "" };
}
