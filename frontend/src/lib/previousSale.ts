import { CLASSIFICATIONS } from "@/lib/classifications";
import type { ParsedValuation } from "@/lib/valuationInput";
import type { ClassificationValue, GradeStats, GradeTierStats, Lot, PreviousGradeStats } from "@/types/api";

/** Single value if set, else the midpoint of the range — mirrors the API's EffectiveValue. */
export function effectiveValuationOf(lot: Lot): number | null {
  const v = lot.valuation;
  if (!v) return null;
  if (v.valuationSingle != null) return v.valuationSingle;
  if (v.valuationFrom != null && v.valuationTo != null) return (v.valuationFrom + v.valuationTo) / 2;
  return v.valuationFrom;
}

/** Same idea for typed-but-unsaved input: the value a parsed entry would settle at. */
export function effectiveOfParsed(parsed: ParsedValuation): number | null {
  if (parsed.kind === "single") return parsed.value;
  if (parsed.kind === "range") return (parsed.from + parsed.to) / 2;
  return null;
}

/** Look up a grade's previous-sale stats, tolerant of spacing/case drift between imports. */
export function gradeStatsFor(stats: PreviousGradeStats | null, grade: string | null): GradeStats | null {
  if (!stats || !grade) return null;
  const key = grade.trim();
  const direct = stats.grades[key];
  if (direct) return direct;
  const upper = key.toUpperCase();
  const match = Object.keys(stats.grades).find((k) => k.trim().toUpperCase() === upper);
  return match ? stats.grades[match] : null;
}

export function tierStatsFor(stats: GradeStats | null, tier: ClassificationValue): GradeTierStats | null {
  return stats?.tiers.find((t) => t.classification === tier) ?? null;
}

/** A tier's typical previous value — its average, with a midpoint fallback. */
const tierCenter = (t: GradeTierStats) => t.avg ?? (t.min + t.max) / 2;

/**
 * Pick the classification the previous sale suggests for this value. The stats arrive
 * as one contiguous scale per grade — each tier's band ends exactly where the next
 * begins — so this is a straight lookup: the band the value falls in, with values off
 * either end clamping to the cheapest/priciest tier, and a value right on a shared
 * boundary going to the better tier. The suggestion therefore always matches the
 * bands shown in the UI, and is monotonic by construction.
 */
export function suggestTier(stats: GradeStats, value: number): ClassificationValue | null {
  if (stats.tiers.length === 0) return null;
  const ordered = [...stats.tiers].sort((a, b) => tierCenter(a) - tierCenter(b));
  for (const t of ordered.slice(0, -1)) {
    if (value < t.max) return t.classification;
  }
  return ordered[ordered.length - 1].classification;
}

const fmt = (n: number) => Math.round(n).toLocaleString();

export function formatTierRange(t: GradeTierStats, withCurrency = true): string {
  const range = t.min === t.max ? fmt(t.min) : `${fmt(t.min)}–${fmt(t.max)}`;
  return withCurrency ? `Rs. ${range}` : range;
}

/**
 * The message shown next to a classification tier: what that grade sold at under this
 * tier in the previous sale, and what share of the grade the tier took.
 * Null when the previous sale had no lots of this grade on that tier.
 */
export function tierSummary(grade: string | null, stats: GradeStats, tier: ClassificationValue): string | null {
  const t = tierStatsFor(stats, tier);
  if (!t) return null;
  const label = CLASSIFICATIONS.find((c) => c.value === tier)?.label ?? tier;
  const share = `${t.count} of ${stats.total} lot${stats.total === 1 ? "" : "s"}, ${Math.round(t.percent)}%`;
  return `${stats.saleName} · ${grade ?? "this grade"} ${label}: ${formatTierRange(t)} (${share})`;
}
