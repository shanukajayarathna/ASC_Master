"use client";

import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useState } from "react";
import { REPORT_TEMPLATES } from "./reportTemplates";
import { BROKER_CHIPS, GROUPS, METRICS, PERIODS, VISUALS, type BuilderState } from "./reportBuilder";

interface Option<T extends string> {
  key: T;
  label: string;
}

function Segment<T extends string>({ name, value, options, onChange }: { name: string; value: T; options: readonly Option<T>[]; onChange: (v: T) => void }) {
  const id = `rb-${name}`;
  return (
    <div className="ws-seg">
      <span className="ws-seg-label" id={id}>{name}</span>
      <ToggleButtonGroup exclusive size="small" value={value} onChange={(_, v: T | null) => v && onChange(v)} aria-labelledby={id} sx={{ flexWrap: "wrap" }}>
        {options.map((o) => (
          <ToggleButton key={o.key} value={o.key} sx={{ textTransform: "none", fontSize: 12.5, minHeight: 40, minWidth: 44, px: 1.25 }}>
            {o.label}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </div>
  );
}

interface ReportBuilderPanelProps {
  state: BuilderState;
  onChange: (next: BuilderState) => void;
  /** "Build from description": hands the text to the Reports agent. Omitted where the chat itself takes requests. */
  onDescribe?: (text: string) => void;
  describing?: boolean;
}

/** The left pane: describe it, or set grouping, brokers, measure, period and visual by hand. */
export default function ReportBuilderPanel({ state, onChange, onDescribe, describing }: ReportBuilderPanelProps) {
  const [text, setText] = useState("");
  const set = <K extends keyof BuilderState>(key: K, value: BuilderState[K]) => onChange({ ...state, [key]: value });
  const toggleBroker = (code: string) => set("brokers", state.brokers.includes(code) ? state.brokers.filter((b) => b !== code) : [...state.brokers, code]);

  return (
    <aside className="ws-lots" aria-label="Builder">
      <h2 className="ws-lots-title">Builder</h2>

      {onDescribe && (
      <form
        className="ws-describe"
        onSubmit={(e) => {
          e.preventDefault();
          if (onDescribe && text.trim() && !describing) onDescribe(text.trim());
        }}
      >
        <TextField
          value={text}
          onChange={(e) => setText(e.target.value)}
          label="Describe it"
          placeholder="e.g. Share of quantity by broker for BOPF over the last 6 sales"
          size="small"
          multiline
          minRows={2}
          maxRows={5}
          fullWidth
          slotProps={{ htmlInput: { maxLength: 1000 } }}
        />
        <Button type="submit" variant="outlined" disabled={!text.trim() || describing} sx={{ minHeight: 40 }}>
          {describing ? "Building…" : "Build from description"}
        </Button>
      </form>
      )}

      <div className="ws-seg">
        <span className="ws-seg-label" id="rb-templates">Start from a template</span>
        <div className="ws-broker-chips" role="group" aria-labelledby="rb-templates">
          {REPORT_TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="ws-broker-chip" title={t.hint} onClick={() => onChange(t.state)}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      <Segment name="Group by" value={state.group} options={GROUPS} onChange={(v) => set("group", v)} />

      <div className="ws-seg">
        <span className="ws-seg-label" id="rb-brokers">Brokers {state.brokers.length === 0 && <em>(all)</em>}</span>
        <div className="ws-broker-chips" role="group" aria-labelledby="rb-brokers">
          {BROKER_CHIPS.map((b) => {
            const on = state.brokers.includes(b.code);
            return (
              <button
                key={b.code}
                type="button"
                className="ws-broker-chip"
                aria-pressed={on}
                title={b.name}
                onClick={() => toggleBroker(b.code)}
                style={{ ["--chip" as string]: b.color }}
              >
                <span className="ws-broker-dot" aria-hidden="true" />
                {b.code}
              </button>
            );
          })}
        </div>
      </div>

      {state.grades.length > 0 && (
        <div className="ws-seg">
          <span className="ws-seg-label">Grade filter</span>
          <div className="ws-broker-chips">
            {state.grades.map((g) => (
              <button key={g} type="button" className="ws-broker-chip" aria-label={`Remove grade filter ${g}`} onClick={() => set("grades", state.grades.filter((x) => x !== g))}>
                {g} ×
              </button>
            ))}
          </div>
        </div>
      )}

      <Segment
        name="Grade type"
        value={state.gradeTypes.length === 1 ? (state.gradeTypes[0] === "Off Grade" ? "off" : "main") : "all"}
        options={[{ key: "all", label: "All" }, { key: "off", label: "Off grade" }, { key: "main", label: "Main grade" }]}
        onChange={(v) => set("gradeTypes", v === "off" ? ["Off Grade"] : v === "main" ? ["Main Grade"] : [])}
      />

      <Segment name="Measure" value={state.metric} options={METRICS} onChange={(v) => set("metric", v)} />
      <Segment name="Period" value={state.period} options={PERIODS.filter((p) => p.key !== "scope" || state.range !== null)} onChange={(v) => set("period", v)} />
      <Segment name="Visual" value={state.visual} options={VISUALS} onChange={(v) => set("visual", v)} />
    </aside>
  );
}
