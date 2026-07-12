"use client";

import type { ColumnMeta } from "@/types/api";
import type { ColumnFilterState, TicketStatus } from "@/lib/lotFilters";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import Checkbox from "@mui/material/Checkbox";
import ListItemText from "@mui/material/ListItemText";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";

const STATUS_OPTIONS: { value: TicketStatus | ""; label: string }[] = [
  { value: "", label: "All" },
  { value: "full", label: "Ticket complete" },
  { value: "partial", label: "In progress" },
  { value: "empty", label: "Not started" },
];

const CLASSIFICATION_OPTIONS = [
  { value: "", label: "All" },
  { value: "SelectBest", label: "Select Best" },
  { value: "Best", label: "Best" },
  { value: "BelowBest", label: "Below Best" },
  { value: "Poor", label: "Poor" },
  { value: "Unclassified", label: "Unclassified" },
];

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] uppercase tracking-wide text-text-muted font-mono mb-1 truncate" title={typeof children === "string" ? children : undefined}>
      {children}
    </label>
  );
}

export default function FilterPanel({
  headers,
  columnMeta,
  columnFilters,
  onColumnFilterChange,
  status,
  onStatusChange,
  classification,
  onClassificationChange,
  onClearAll,
}: {
  headers: string[];
  columnMeta: Record<string, ColumnMeta>;
  columnFilters: Record<string, ColumnFilterState>;
  onColumnFilterChange: (header: string, value: ColumnFilterState) => void;
  status: TicketStatus | "";
  onStatusChange: (v: TicketStatus | "") => void;
  classification: string;
  onClassificationChange: (v: string) => void;
  onClearAll: () => void;
}) {
  return (
    <div className="border border-border rounded-md bg-surface-sunken mb-3">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h4 className="font-display text-[14px] font-semibold text-text m-0">Filter by column</h4>
        <button type="button" onClick={onClearAll} className="text-[12px] text-text-muted underline hover:text-liquor bg-transparent border-none cursor-pointer">
          Clear all
        </button>
      </div>

      <div
        className="grid gap-x-3.5 gap-y-3 px-4 pb-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))" }}
      >
        {/* Standard filters that aren't raw columns */}
        <div>
          <FieldLabel>Ticket Status</FieldLabel>
          <FormControl size="small" fullWidth>
            <Select value={status} onChange={(e) => onStatusChange(e.target.value as TicketStatus | "")}>
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        <div>
          <FieldLabel>Classification</FieldLabel>
          <FormControl size="small" fullWidth>
            <Select value={classification} onChange={(e) => onClassificationChange(e.target.value)}>
              {CLASSIFICATION_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>

        {/* One field per catalogue column, shape depends on its detected type */}
        {headers.map((h) => {
          const meta = columnMeta[h];
          const f = columnFilters[h];

          if (meta?.categorical) {
            const selected = f?.kind === "categorical" ? f.values : [];
            return (
              <div key={h}>
                <FieldLabel>{h}</FieldLabel>
                <FormControl size="small" fullWidth>
                  <Select
                    multiple
                    displayEmpty
                    value={selected}
                    renderValue={(v) => (v.length === 0 ? <span className="text-text-muted">All</span> : v.length === 1 ? v[0] : `${v.length} selected`)}
                    onChange={(e) => {
                      const value = e.target.value;
                      const values = typeof value === "string" ? value.split(",") : value;
                      onColumnFilterChange(h, { kind: "categorical", values });
                    }}
                  >
                    {meta.options.map((opt) => (
                      <MenuItem key={opt} value={opt} dense>
                        <Checkbox checked={selected.includes(opt)} size="small" />
                        <ListItemText primary={opt} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
              </div>
            );
          }

          if (meta?.numeric) {
            const min = f?.kind === "numeric" ? f.min : "";
            const max = f?.kind === "numeric" ? f.max : "";
            return (
              <div key={h}>
                <FieldLabel>{h}</FieldLabel>
                <div className="flex gap-1.5">
                  <TextField
                    size="small"
                    type="number"
                    placeholder="Min"
                    value={min}
                    onChange={(e) => onColumnFilterChange(h, { kind: "numeric", min: e.target.value, max })}
                    fullWidth
                  />
                  <TextField
                    size="small"
                    type="number"
                    placeholder="Max"
                    value={max}
                    onChange={(e) => onColumnFilterChange(h, { kind: "numeric", min, max: e.target.value })}
                    fullWidth
                  />
                </div>
              </div>
            );
          }

          const value = f?.kind === "text" ? f.value : "";
          return (
            <div key={h}>
              <FieldLabel>{h}</FieldLabel>
              <TextField
                size="small"
                placeholder="Contains…"
                value={value}
                onChange={(e) => onColumnFilterChange(h, { kind: "text", value: e.target.value })}
                fullWidth
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}
