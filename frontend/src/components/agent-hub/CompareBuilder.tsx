"use client";

import Button from "@mui/material/Button";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useState } from "react";

export const DIMENSIONS = [
  { key: "broker", label: "Brokers", phrase: "brokers" },
  { key: "grade", label: "Grades", phrase: "grades" },
  { key: "sale", label: "Sales (trend)", phrase: "sales, as a trend" },
] as const;
export const METRICS = [
  { key: "avg", label: "Avg price", phrase: "average price (Rs/kg)" },
  { key: "qty", label: "Quantity", phrase: "quantity sold (kg)" },
  { key: "proceeds", label: "Proceeds", phrase: "proceeds (Rs)" },
] as const;
export const PERIODS = [
  { key: "4", label: "Last 4 sales", phrase: "the last 4 sales" },
  { key: "12", label: "Last 12 sales", phrase: "the last 12 sales" },
  { key: "year", label: "This year", phrase: "the current year so far" },
  { key: "all", label: "13 years", phrase: "the full 13-year archive (by year)" },
] as const;

type Dim = (typeof DIMENSIONS)[number]["key"];
type Metric = (typeof METRICS)[number]["key"];
type Period = (typeof PERIODS)[number]["key"];

/** The question the builder sends. Exported so the wording is testable and reused nowhere else. */
export function comparePrompt(dim: Dim, metric: Metric, period: Period): string {
  const d = DIMENSIONS.find((x) => x.key === dim)!;
  const m = METRICS.find((x) => x.key === metric)!;
  const p = PERIODS.find((x) => x.key === period)!;
  return `Compare ${d.phrase} by ${m.phrase} over ${p.phrase}. State the scope you used, then show a table and a chart.`;
}

function Segment<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: readonly { key: T; label: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="ws-seg">
      <span className="ws-seg-label" id={`seg-${label}`}>{label}</span>
      <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, v: T | null) => v && onChange(v)} aria-labelledby={`seg-${label}`} sx={{ flexWrap: "wrap" }}>
        {options.map((o) => (
          <ToggleButton key={o.key} value={o.key} sx={{ textTransform: "none", fontSize: 12.5, minHeight: 40, minWidth: 44, px: 1.25 }}>
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

/** Pick what to compare, by what, over which period — and send one well-formed question to the agent. */
export default function CompareBuilder({ onAsk, busy }: { onAsk: (question: string) => void; busy: boolean }) {
  const [dim, setDim] = useState<Dim>("broker");
  const [metric, setMetric] = useState<Metric>("avg");
  const [period, setPeriod] = useState<Period>("12");

  return (
    <section className="ws-compare" aria-label="Compare">
      <h2 className="ws-lots-title">Compare</h2>
      <Segment label="Across" value={dim} options={DIMENSIONS} onChange={setDim} />
      <Segment label="Measure" value={metric} options={METRICS} onChange={setMetric} />
      <Segment label="Period" value={period} options={PERIODS} onChange={setPeriod} />
      <Button variant="contained" disabled={busy} onClick={() => onAsk(comparePrompt(dim, metric, period))} sx={{ minHeight: 44 }}>
        Compare
      </Button>
    </section>
  );
}
