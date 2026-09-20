import type { AgentKey } from "./agents";

export interface Handoff {
  agent: Exclude<AgentKey, "general">;
  reason: string;
}

/**
 * Suggests a specialist for a question typed in General, by plain keyword rules (the backend router only resolves
 * an agent key; it doesn't classify). It is a suggestion the user can ignore — the answer from General is never
 * held back. Order matters: building a file or report beats archive analysis, which beats lot-level questions.
 */
export function suggestSpecialist(text: string): Handoff | null {
  const t = text.toLowerCase();
  if (/\b(report|deck|powerpoint|pptx|slides|presentation|excel|spreadsheet|pdf|snapshot|export)\b/.test(t))
    return { agent: "reports", reason: "building or exporting a report" };
  if (/\b(trend|compare|comparison|over the last|last \d+ sales|13 years|archive|history|market share|by broker|by grade|broker performance|mark performance|mark history|per sale|year on year)\b/.test(t))
    return { agent: "analytics", reason: "comparing brokers, grades or periods over the archive" };
  if (/\b(lot\s*#?\s*\d+|lot number|valuation|valued|garden|catalogue|top price|top lots|highest price|this sale|current sale)\b/.test(t))
    return { agent: "auction", reason: "looking up lots and valuations in the current sale" };
  return null;
}

export const handoffHref = (agent: Handoff["agent"], question: string) =>
  `/assistant/${agent}?send=1&q=${encodeURIComponent(question)}`;
