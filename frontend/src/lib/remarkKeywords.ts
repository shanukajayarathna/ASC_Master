/**
 * Master keyword lists tasters pick from for each remark field — mirrors the company's
 * Standard Data / Adjective Data / Liquor Remarks / Remarks reference sheets. Rendered as
 * clickable chips wherever a lot's remarks are edited, so the same shorthand is used
 * everywhere instead of free-typed variants of the same term.
 */
/**
 * `standardData` is deliberately absent: the Standard field holds exactly one sub-grade
 * code (SB++ … P--), which the sub-grade picker owns everywhere it is edited. Offering
 * those same codes as free-text chips here produced two writers for one field, disagreeing
 * on the vocabulary (chips had no ++/-- forms, and bare "B" was not a recognised code at
 * all, so auto-selection appended its own token and left "B++, B" behind). Keeping the
 * field out of this union makes that combination un-writable rather than merely unused.
 */
export type RemarkKeywordField = "adjectiveData" | "liquorRemarks" | "brokerNotes";

export interface RemarkKeyword {
  code: string;
  description: string;
}

export const REMARK_KEYWORDS: Record<RemarkKeywordField, RemarkKeyword[]> = {
  adjectiveData: [
    { code: "-", description: "Inferior" },
    { code: "+", description: "Better" },
    { code: "+Style", description: "Better style" },
    { code: "++", description: "Much better" },
    { code: "--", description: "Much inferior" },
    { code: "=", description: "Equal" },
    { code: "=/+", description: "Equal to plus" },
    { code: "=/-", description: "Equal to minus" },
    { code: "bold", description: "Bold" },
    { code: "D/S", description: "Different style" },
    { code: "D/S+", description: "Different style +" },
    { code: "D/S++", description: "Different style ++" },
    { code: "D/S-", description: "Different style -" },
    { code: "D/S--", description: "Different style --" },
    { code: "D/S bold", description: "Different style bold" },
  ],
  liquorRemarks: [
    { code: "ADQ ST", description: "Adequate strength" },
    { code: "bakey", description: "Bakey" },
    { code: "Burnt", description: "Burnt" },
    { code: "colory", description: "Colory" },
    { code: "Fc/Fs", description: "Fair colour, fair strength" },
    { code: "Fc/Fs/Fb", description: "Fair colour, fair strength, fair brightness" },
    { code: "FF", description: "Fully fired" },
    { code: "Fruity", description: "Fruity" },
    { code: "greenish", description: "Greenish" },
    { code: "HF", description: "High fired" },
    { code: "moldy", description: "Moldy" },
    { code: "plain", description: "Plain" },
    { code: "smoky", description: "Smoky" },
    { code: "Soft", description: "Soft" },
    { code: "tainted", description: "Tainted" },
    { code: "Uc/Us/Ub", description: "Useful colour, useful strength, useful brightness" },
  ],
  brokerNotes: [
    { code: "backish", description: "Backish" },
    { code: "bold", description: "Bold" },
    { code: "brown", description: "Brown" },
    { code: "curly", description: "Curly" },
    { code: "flaky", description: "Flaky" },
    { code: "grey", description: "Grey" },
    { code: "open", description: "Open" },
    { code: "short", description: "Short" },
    { code: "shotty", description: "Shotty" },
    { code: "twisted", description: "Twisted" },
    { code: "wiry", description: "Wiry" },
  ],
};

/** Comma-separated tokens, case-insensitively compared, so re-clicking a chip removes it. */
function tokensOf(value: string): string[] {
  return value
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

export function hasKeyword(value: string, keyword: string): boolean {
  return tokensOf(value).some((t) => t.toLowerCase() === keyword.toLowerCase());
}

/** Adds the keyword as a new comma-separated token, or removes it if already present. */
export function toggleKeyword(value: string, keyword: string): string {
  const tokens = tokensOf(value);
  const idx = tokens.findIndex((t) => t.toLowerCase() === keyword.toLowerCase());
  if (idx >= 0) tokens.splice(idx, 1);
  else tokens.push(keyword);
  return tokens.join(", ");
}
