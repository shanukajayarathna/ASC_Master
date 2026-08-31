"use client";

import { columnOptions, CURATED_FILTERS, resolveHeader, TICK_FILTERS } from "@/lib/filterConfig";
import { filterLots, type ColumnFilterState, type TicketStatus } from "@/lib/lotFilters";
import type { ColumnMeta, Lot } from "@/types/api";
import Autocomplete from "@mui/material/Autocomplete";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useDeferredValue, useMemo } from "react";

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

/** How many dropdown options show at once — the rest appear as the user types. */
const MAX_VISIBLE_OPTIONS = 8;
/** Marker "option" that renders the …N more hint row; never selectable. */
const MORE_PREFIX = " more:";

function FieldLabel({ children }: { children: React.ReactNode }) {
  return (
    <label className="block text-[10px] uppercase tracking-wide text-text-muted font-mono mb-1 truncate" title={typeof children === "string" ? children : undefined}>
      {children}
    </label>
  );
}

/** The shared type-ahead multi-select: shows a handful of options and narrows letter by
 *  letter, with a "…N more" hint row when the list is longer than what's shown. */
function PickAutocomplete({
  options,
  selected,
  onChange,
  placeholder = "All — type to search",
}: {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  return (
    <Autocomplete
      multiple
      size="small"
      options={options}
      value={selected}
      disableCloseOnSelect
      limitTags={1}
      onChange={(_, values) => onChange(values.filter((v) => !v.startsWith(MORE_PREFIX)))}
      filterOptions={(opts, state) => {
        const q = state.inputValue.trim().toLowerCase();
        const hits = q ? opts.filter((o) => o.toLowerCase().includes(q)) : opts;
        return hits.length > MAX_VISIBLE_OPTIONS
          ? [...hits.slice(0, MAX_VISIBLE_OPTIONS), `${MORE_PREFIX}${hits.length - MAX_VISIBLE_OPTIONS}`]
          : hits;
      }}
      getOptionDisabled={(o) => o.startsWith(MORE_PREFIX)}
      renderOption={(props, option, { selected: isSelected }) => {
        const { key, ...rest } = props as { key?: React.Key } & React.HTMLAttributes<HTMLLIElement>;
        if (option.startsWith(MORE_PREFIX)) {
          return (
            <li key={key ?? option} {...rest} className="px-3 py-1.5 text-[12px] italic text-text-muted list-none">
              …{option.slice(MORE_PREFIX.length)} more — keep typing to narrow
            </li>
          );
        }
        return (
          <li key={key ?? option} {...rest}>
            <Checkbox size="small" sx={{ p: 0.25, mr: 0.5 }} checked={isSelected} />
            <span className="text-[13px]">{option}</span>
          </li>
        );
      }}
      renderInput={(params) => <TextField {...params} placeholder={selected.length === 0 ? placeholder : undefined} />}
    />
  );
}

export default function FilterPanel({
  headers,
  lots,
  columnFilters,
  onColumnFilterChange,
  status,
  onStatusChange,
  classification,
  onClassificationChange,
  year,
  onYearChange,
  allYears,
  onClearAll,
  variant = "default",
  extraCategoricalHeaders,
}: {
  headers: string[];
  /** Still accepted for call-site compatibility; options now derive from `lots` instead. */
  columnMeta?: Record<string, ColumnMeta>;
  /**
   * The lots the filters act on. Each dropdown's option list is derived live from
   * these, narrowed by every *other* active filter — so picking Category leaves Grade
   * (and every other dropdown) showing only values that actually co-occur with it.
   */
  lots: Lot[];
  columnFilters: Record<string, ColumnFilterState>;
  onColumnFilterChange: (header: string, value: ColumnFilterState) => void;
  status: TicketStatus | "";
  onStatusChange: (v: TicketStatus | "") => void;
  classification: string;
  onClassificationChange: (v: string) => void;
  year: string;
  onYearChange: (v: string) => void;
  /** Every year known to the system (from all catalogues, not just currently-loaded
   *  lots) — merged into the Year dropdown's options so a year with no sale loaded yet
   *  is still pickable; picking one is expected to load its sales (see onYearChange's
   *  call site, which auto-expands the working set). */
  allYears?: number[];
  onClearAll: () => void;
  /**
   * "valuation" tailors the panel to the Valuation Centre: the auction-outcome tick
   * groups (Sale Status / Reprint / Rainforest) don't apply while valuing and are
   * hidden, and the Invoice No dropdown becomes a free-text search. (Lot Number always
   * gets its own range + pick-any-lot controls, in every variant — see lotNoHeader.)
   */
  variant?: "default" | "valuation";
  /**
   * Extra categorical columns to offer as dropdowns beyond the curated shortlist — used for
   * the synthetic "Sale" column when the working set spans several sales, so lots can be
   * narrowed to particular sales after they've been pooled.
   */
  extraCategoricalHeaders?: string[];
}) {
  const isValuation = variant === "valuation";

  // Deferred copies of the active filters, used only for deriving the option lists below.
  // Each list derivation runs filterLots over the whole working set (once per dropdown), so
  // doing it against the live values froze every keystroke in a filter field; against these,
  // the keystroke paints immediately (the inputs stay bound to the live props) and the
  // narrowing catches up in an interruptible background render right after.
  const dColumnFilters = useDeferredValue(columnFilters);
  const dStatus = useDeferredValue(status);
  const dClassification = useDeferredValue(classification);
  const dYear = useDeferredValue(year);

  // Direct-entry Lot Number column, resolved with the same patterns the curated dropdowns
  // use. A sale can carry thousands of distinct lot numbers (they restart per broker), far
  // too many for the type-ahead combo below to browse usefully — every variant gets the
  // numeric range + pick-any-lot controls instead (see lotFilter/lotOptions).
  const lotNoHeader = useMemo(
    () => resolveHeader(headers, CURATED_FILTERS.find((d) => d.label === "Lot Number")!.patterns),
    [headers]
  );
  const invoiceHeader = useMemo(
    () => (isValuation ? resolveHeader(headers, CURATED_FILTERS.find((d) => d.label === "Invoice No")!.patterns) : null),
    [headers, isValuation]
  );

  // Lots relevant to one filter's own option list: every other active filter applied
  // (column filters, ticket status, classification, year) but not this header's own
  // selection — so picking a Category narrows what Grade offers without a Grade pick
  // shrinking Grade's own list down to just itself.
  const lotsFor = (excludeHeader: string): Lot[] => {
    if (Object.keys(dColumnFilters).length === 0 && !dStatus && !dClassification && !dYear) return lots;
    const rest = { ...dColumnFilters };
    delete rest[excludeHeader];
    return filterLots(lots, { search: "", columnFilters: rest, status: dStatus, classification: dClassification, year: dYear });
  };

  // Resolve the curated shortlist against this catalogue's real headers, and drop any
  // filter whose column is missing or has no data among the lots that match every
  // other active filter.
  const curated = useMemo(() => {
    return CURATED_FILTERS.filter(
      (def) => def.label !== "Lot Number" && !(isValuation && def.label === "Invoice No")
    )
      .map((def) => {
        const header = resolveHeader(headers, def.patterns);
        return header ? { def, header, options: columnOptions(lotsFor(header), header) } : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.options.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, lots, isValuation, dColumnFilters, dStatus, dClassification, dYear]);

  const ticks = useMemo(
    () =>
      isValuation
        ? []
        : TICK_FILTERS.map((def) => ({ def, header: resolveHeader(headers, def.patterns) })).filter(
            (x): x is { def: (typeof TICK_FILTERS)[number]; header: string } => x.header !== null
          ),
    [headers, isValuation]
  );

  // Range and hand-picked lot numbers live in one combined filter, so setting one
  // never wipes the other — a lot shows when it's in the range OR among the picks.
  const lotFilter = (() => {
    const f = lotNoHeader ? columnFilters[lotNoHeader] : undefined;
    return f?.kind === "lot" ? f : { kind: "lot" as const, values: [], min: "", max: "" };
  })();
  const lotOptions = useMemo(
    () =>
      lotNoHeader
        ? columnOptions(lotsFor(lotNoHeader), lotNoHeader).sort((a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0))
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lots, lotNoHeader, dColumnFilters, dStatus, dClassification, dYear]
  );
  const invoiceValue = (() => {
    const f = invoiceHeader ? columnFilters[invoiceHeader] : undefined;
    return f?.kind === "text" ? f.value : "";
  })();

  const years = useMemo(() => {
    const relevant =
      Object.keys(dColumnFilters).length === 0 && !dStatus && !dClassification
        ? lots
        : filterLots(lots, { search: "", columnFilters: dColumnFilters, status: dStatus, classification: dClassification, year: "" });
    const loaded = relevant.map((l) => l.saleYear).filter((y): y is string => !!y);
    // Union with every year the system knows about (not just currently-loaded lots) —
    // otherwise a year with no sale in the working set yet simply can't be picked here.
    const known = (allYears ?? []).map(String);
    return [...new Set([...loaded, ...known])].sort();
  }, [lots, dColumnFilters, dStatus, dClassification, allYears]);

  const selectedOf = (header: string): string[] => {
    const f = columnFilters[header];
    return f?.kind === "categorical" ? f.values : [];
  };

  const toggleTick = (header: string, option: string) => {
    const selected = selectedOf(header);
    const values = selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option];
    onColumnFilterChange(header, { kind: "categorical", values });
  };

  return (
    <div className="border border-border rounded-md bg-surface-sunken mb-3">
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h4 className="font-display text-[14px] font-semibold text-text m-0">Filters</h4>
        <button type="button" onClick={onClearAll} className="text-[12px] text-text-muted underline hover:text-liquor bg-transparent border-none cursor-pointer">
          Clear all
        </button>
      </div>

      {/* Tick groups: auction outcome and the two yes/no flags, plus the app's own
          ticket-status/classification selectors. */}
      <div className="flex items-end gap-x-6 gap-y-3 flex-wrap px-4 pb-3">
        {ticks.map(({ def, header }) => {
          const selected = selectedOf(header);
          return (
            <div key={def.label}>
              <FieldLabel>{def.label}</FieldLabel>
              <div className="flex gap-x-3 items-center">
                {def.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-1 text-[12.5px] text-text cursor-pointer select-none">
                    <Checkbox
                      size="small"
                      sx={{ p: 0.25 }}
                      checked={selected.includes(opt)}
                      onChange={() => toggleTick(header, opt)}
                    />
                    {opt}
                  </label>
                ))}
              </div>
            </div>
          );
        })}
        {lotNoHeader && (
          <div>
            <FieldLabel>Lot No Range</FieldLabel>
            <div className="flex items-center gap-1.5">
              <TextField
                size="small"
                placeholder="From"
                value={lotFilter.min}
                sx={{ width: 90 }}
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                onChange={(e) =>
                  onColumnFilterChange(lotNoHeader, { ...lotFilter, min: e.target.value.replace(/\D/g, "") })
                }
              />
              <span className="text-text-muted text-[13px]">–</span>
              <TextField
                size="small"
                placeholder="To"
                value={lotFilter.max}
                sx={{ width: 90 }}
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                onChange={(e) =>
                  onColumnFilterChange(lotNoHeader, { ...lotFilter, max: e.target.value.replace(/\D/g, "") })
                }
              />
            </div>
          </div>
        )}
        {lotNoHeader && (
          <div className="min-w-[190px]">
            <FieldLabel>Specific Lots (added to range)</FieldLabel>
            <PickAutocomplete
              options={lotOptions}
              selected={lotFilter.values}
              onChange={(values) => onColumnFilterChange(lotNoHeader, { ...lotFilter, values })}
              placeholder="Pick lots from anywhere"
            />
          </div>
        )}
        {invoiceHeader && (
          <div className="min-w-[150px]">
            <FieldLabel>Invoice No</FieldLabel>
            <TextField
              size="small"
              fullWidth
              placeholder="Type to match"
              value={invoiceValue}
              onChange={(e) => onColumnFilterChange(invoiceHeader, { kind: "text", value: e.target.value })}
            />
          </div>
        )}
        <div className="min-w-[110px]">
          <FieldLabel>Year</FieldLabel>
          <FormControl size="small" fullWidth>
            <Select value={year} displayEmpty onChange={(e) => onYearChange(e.target.value)}>
              <MenuItem value="">All</MenuItem>
              {years.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        <div className="min-w-[150px]">
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
        <div className="min-w-[150px]">
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
      </div>

      {/* The curated dropdowns: type-ahead comboboxes that show a handful of options
          and narrow letter by letter as the user types. */}
      <div
        className="grid gap-x-3.5 gap-y-3 px-4 pb-4"
        style={{ gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))" }}
      >
        {(extraCategoricalHeaders ?? []).map((header) => (
          <div key={`extra-${header}`}>
            <FieldLabel>{header}</FieldLabel>
            <PickAutocomplete
              options={columnOptions(lotsFor(header), header)}
              selected={selectedOf(header)}
              onChange={(values) => onColumnFilterChange(header, { kind: "categorical", values })}
            />
          </div>
        ))}
        {curated.map(({ def, header, options }) => (
          <div key={def.label}>
            <FieldLabel>{def.label}</FieldLabel>
            <PickAutocomplete
              options={options}
              selected={selectedOf(header)}
              onChange={(values) => onColumnFilterChange(header, { kind: "categorical", values })}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
