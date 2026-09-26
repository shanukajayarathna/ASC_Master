import type { ChatScope } from "@/types/api";
import { ELEVATION_SETS, type BuilderState, type GroupKey, type MetricKey, type PeriodKey, type VisualKey } from "./reportBuilder";

/** The line the Voice Builder offers as an example. */
export const SAMPLE_LINE = "Compare brokers for BOPF over the last 12 sales, then make a deck.";

export interface VoiceCommand {
  /** What to change in the builder. Empty when nothing was recognised. */
  patch: Partial<BuilderState>;
  /** Plain-language description of what was understood, in the order it will show. */
  understood: string[];
  /** Things heard but not supported, so the user is told rather than silently ignored. */
  notes: string[];
  wantsDeck: boolean;
}

const BROKER_WORDS: [RegExp, string][] = [
  [/\b(asia siyaka|asc)\b/, "ASC"],
  [/\b(forbes|fw)\b/, "FW"],
  [/\b(bartleet|bc)\b/, "BC"],
  [/\b(ceylon tea brokers?|ct)\b/, "CT"],
  [/\b(eastern|eb)\b/, "EB"],
  [/\b(keells|jk)\b/, "JK"],
  [/\b(lanka commodity|lc)\b/, "LC"],
  [/\b(mercantile|mpb)\b/, "MPB"],
];

/** Common tea grades a person might say; the archive itself validates the final value. */
const GRADES = ["FBOPF1", "FBOPF", "FBOP", "BOPF1", "BOPF", "BOP1", "BOPSM", "BOP", "OP1", "OPA", "OP", "PEKOE", "PEK", "BP1", "BPF", "BP", "FNGS1", "FNGS", "DUST1", "DUST", "FGS", "FF1", "FF"];

const GROUP_LABEL: Record<GroupKey, string> = { broker: "brokers", grade: "grades", sale: "sales (trend)", elevation: "origins", buyer: "buyers", mark: "marks" };
const METRIC_LABEL: Record<MetricKey, string> = { avg_price_rs: "average price", sold_quantity_kg: "quantity sold", proceeds_rs: "proceeds", sold_lots: "lots sold", share_of_own_volume_pct: "share of own volume" };
const PERIOD_LABEL: Record<PeriodKey, string> = { "4": "last 4 sales", "12": "last 12 sales", year: "this year", latest: "the latest sale", scope: "the chosen scope" };
const VISUAL_LABEL: Record<VisualKey, string> = { bar: "bar chart", line: "line chart", table: "table" };

const WORD_NUMBERS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };

function group(t: string): GroupKey | null {
  if (/\b(trend|over time|each sale|per sale|sale by sale|week by week)\b/.test(t)) return "sale";
  // "by broker(s)" / "compare grades" — the noun the request is about, never the "sales" in "last 12 sales".
  const noun = t.match(/\b(?:compare|by|per|across|for each|of)\s+(?:the\s+)?(brokers?|grades?|origins?|elevations?|buyers?|marks?)\b/) ?? t.match(/\b(brokers?|grades?|origins?|elevations?|buyers?|marks?)\b/);
  if (!noun) return null;
  return noun[1].startsWith("broker") ? "broker" : noun[1].startsWith("grade") ? "grade" : noun[1].startsWith("buyer") ? "buyer" : noun[1].startsWith("mark") ? "mark" : "elevation";
}

function period(t: string, notes: string[]): PeriodKey | null {
  const n = t.match(/\blast\s+(\d+|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b/);
  if (n) {
    const count = /^\d+$/.test(n[1]) ? Number(n[1]) : (WORD_NUMBERS[n[1]] ?? 0);
    if (count === 4) return "4";
    if (count === 12) return "12";
    notes.push(`The builder covers the last 4 or the last 12 sales, so “last ${n[1]}” became the last ${count < 8 ? 4 : 12}.`);
    return count < 8 ? "4" : "12";
  }
  if (/\b(this year|year so far|current year|yearly)\b/.test(t)) return "year";
  if (/\b(latest sale|this week|current sale|last sale|most recent sale)\b/.test(t)) return "latest";
  return null;
}

const ELEVATION_WORDS: [RegExp, readonly string[]][] = [
  [/\buva high\b/, ["UVA HIGH"]],
  [/\bwestern high\b/, ["WESTERN HIGH"]],
  [/\buva medium\b/, ["UVA MEDIUM"]],
  [/\bwestern medium\b/, ["WESTERN MEDIUM"]],
  [/\bhigh[ -]grown\b/, ELEVATION_SETS.high],
  [/\b(medium|mid)[ -]grown\b/, ELEVATION_SETS.medium],
  [/\blow[ -]grown\b/, ELEVATION_SETS.low],
];

const wholeYear = (y: number): ChatScope => ({ fromYear: y, fromSale: null, toYear: y, toSale: null });

/** A named sale ("sale 32 of 2026"), a year ("in 2025", "last year"), or nothing. A sale number without a year is reported, not guessed. */
function specificPeriod(t: string, notes: string[], now: Date): { scope: ChatScope; label: string } | null {
  const sale = t.match(/\bsale\s*#?\s*(\d{1,2})\b/);
  const year = t.match(/\b(20\d\d)\b/);
  if (sale && year) {
    const y = Number(year[1]);
    const n = Number(sale[1]);
    return { scope: { fromYear: y, fromSale: n, toYear: y, toSale: n }, label: `sale ${String(n).padStart(2, "0")}/${y}` };
  }
  if (sale) {
    notes.push(`“sale ${sale[1]}” needs a year — say “sale ${sale[1]} of 2026”, or use “Any sale, range or year”.`);
    return null;
  }
  if (/\blast year\b/.test(t)) return { scope: wholeYear(now.getFullYear() - 1), label: `the whole of ${now.getFullYear() - 1}` };
  if (year) return { scope: wholeYear(Number(year[1])), label: `the whole of ${year[1]}` };
  return null;
}

/**
 * Turns a spoken (or typed) request into builder settings. Deliberately plain keyword rules — no model — so the
 * same words always give the same result and the user can see exactly what was understood before anything runs.
 */
export function parseVoiceCommand(input: string, now: Date = new Date()): VoiceCommand {
  const t = input.toLowerCase().replace(/[.,!?]/g, " ").replace(/\s+/g, " ").trim();
  const patch: Partial<BuilderState> = {};
  const understood: string[] = [];
  const notes: string[] = [];

  const g = group(t);
  if (g) {
    patch.group = g;
    understood.push(`Group by ${GROUP_LABEL[g]}`);
  }

  const brokers = BROKER_WORDS.filter(([re]) => re.test(t)).map(([, code]) => code);
  if (brokers.length > 0) {
    patch.brokers = brokers;
    understood.push(`Brokers: ${brokers.join(", ")}`);
  } else if (g === "broker") {
    patch.brokers = [];
  }

  const grades = GRADES.filter((gr) => new RegExp(`\\b${gr.toLowerCase()}\\b`).test(t));
  // A longer grade name swallows its own prefix ("BOPF1" also contains BOPF); keep the most specific match only.
  const specific = grades.filter((gr) => !grades.some((other) => other !== gr && other.startsWith(gr) && new RegExp(`\\b${other.toLowerCase()}\\b`).test(t)));
  if (specific.length > 0) {
    patch.grades = specific;
    understood.push(`Grade: ${specific.join(", ")}`);
  }

  const gradeTypes = /\boff[- ]?grades?\b/.test(t) ? ["Off Grade"] : /\bmain[- ]?grades?\b/.test(t) ? ["Main Grade"] : null;
  if (gradeTypes) {
    patch.gradeTypes = gradeTypes;
    understood.push(`Grade type: ${gradeTypes[0]}`);
  }

  const share = /\b(share of (their|its|our|each broker'?s?|the broker'?s?) own|of (their|its|our) own (volume|quantity|offering)|own volume|% of (their |its |our )?own|percentage of (their |its |our )?own)\b/.test(t);
  const m: MetricKey | null = share ? "share_of_own_volume_pct" : /\b(average price|avg price|avg|price|prices)\b/.test(t)
    ? "avg_price_rs"
    : /\b(proceeds|revenue|value)\b/.test(t)
      ? "proceeds_rs"
      : /\b(lots)\b/.test(t)
        ? "sold_lots"
        : /\b(quantity|volume|kilos|kg|tonnes|sold)\b/.test(t)
          ? "sold_quantity_kg"
          : null;
  if (m) {
    patch.metric = m;
    understood.push(`Measure: ${METRIC_LABEL[m]}`);
  }

  const elevations = ELEVATION_WORDS.flatMap(([re, values]) => (re.test(t) ? values : []));
  if (elevations.length > 0) {
    patch.elevations = [...new Set(elevations)];
    understood.push(`Elevation: ${patch.elevations.join(", ")}`);
  }

  const named = specificPeriod(t, notes, now);
  const p = named ? null : period(t, notes);
  if (named) {
    patch.range = named.scope;
    patch.period = "scope";
    understood.push(`Period: ${named.label}`);
  } else if (p) {
    patch.period = p;
    understood.push(`Period: ${PERIOD_LABEL[p]}`);
  }

  const v: VisualKey | null = /\btable\b/.test(t) ? "table" : /\b(line|trend)\b/.test(t) ? "line" : /\b(bar|chart|graph)\b/.test(t) ? "bar" : null;
  if (v) {
    patch.visual = v;
    understood.push(`Visual: ${VISUAL_LABEL[v]}`);
  }

  const wantsDeck = /\b(deck|powerpoint|power point|slides?|presentation|pptx)\b/.test(t);
  if (wantsDeck) understood.push("Then make a deck");

  return { patch, understood, notes, wantsDeck };
}

/** Applies a command onto the current builder state (a spoken request replaces what it mentions and leaves the rest). */
export function applyVoiceCommand(state: BuilderState, cmd: VoiceCommand): BuilderState {
  // A new grouping/subject starts with a clean grade filter unless one was spoken.
  const fresh = !!(cmd.patch.group || cmd.patch.metric);
  const base: BuilderState = {
    ...state,
    grades: cmd.patch.grades ? state.grades : fresh ? [] : state.grades,
    gradeTypes: cmd.patch.gradeTypes ? state.gradeTypes : fresh ? [] : state.gradeTypes,
    elevations: cmd.patch.elevations ? state.elevations : fresh ? [] : state.elevations,
  };
  const merged = { ...base, ...cmd.patch };
  // Share of a broker's own volume only makes sense per broker.
  return merged.metric === "share_of_own_volume_pct" ? { ...merged, group: "broker" } : merged;
}
