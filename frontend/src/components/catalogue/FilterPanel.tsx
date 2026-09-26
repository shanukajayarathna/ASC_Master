"use client";

import { columnOptions, CURATED_FILTERS, resolveHeader, TICK_FILTERS } from "@/lib/filterConfig";
import { filterLots, type ColumnFilterState, type TicketStatus } from "@/lib/lotFilters";
import type { ColumnMeta, Lot } from "@/types/api";
import SearchIcon from "@mui/icons-material/Search";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import { VIRTUALIZE_ABOVE, VirtualListbox, VirtualScrollContext } from "@/components/shared/DropdownList";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

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

/** The shared type-ahead multi-select: lists EVERY option and narrows letter by letter as the user types.
 *  Six rows in view with a scroll, always opening below the field - both come from the app theme. */
function PickAutocomplete({
  options,
  selected,
  onChange,
  placeholder = "Type to search",
}: {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
}) {
  // Controlled so a pick made with the KEYBOARD can close the list: the next Enter then runs the search (a mouse tick
  // leaves it open, for picking several values in a row).
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState<string | null>(null);
  const filteredRef = useRef<string[]>(options);
  const scrollRef = useRef<((index: number) => void) | null>(null);
  // Only very long lists (every lot number of a sale) are drawn virtually; ordinary lists use MUI's own list, whose
  // keyboard handling (arrows move the highlight and scroll it into view, Enter picks) already works.
  const virtual = options.length > VIRTUALIZE_ABOVE;
  return (
    <VirtualScrollContext.Provider value={scrollRef}>
      <Autocomplete
        multiple
        size="small"
        options={options}
        value={selected}
        disableCloseOnSelect
        limitTags={1}
        open={open}
        onOpen={() => setOpen(true)}
        onClose={() => setOpen(false)}
        onChange={(event, values) => {
          onChange(values);
          if (event.type === "keydown") setOpen(false);
        }}
        onHighlightChange={(_, option, reason) => {
          setHighlighted(option);
          if (virtual && option && reason === "keyboard") {
            const index = filteredRef.current.indexOf(option);
            if (index >= 0) scrollRef.current?.(index);
          }
        }}
        filterOptions={(opts, state) => {
          const q = state.inputValue.trim().toLowerCase();
          const hits = q ? opts.filter((o) => o.toLowerCase().includes(q)) : opts;
          filteredRef.current = hits;
          return hits;
        }}
        slots={virtual ? { listbox: VirtualListbox } : undefined}
        renderOption={(props, option, { selected: isSelected }) => {
          const { key, style, ...rest } = props as { key?: React.Key } & React.HTMLAttributes<HTMLLIElement>;
          // A virtual row is re-created as it scrolls, so MUI's own DOM-based highlight would be lost: paint it here.
          const focused = virtual && option === highlighted;
          return (
            <li key={key ?? option} {...rest} style={{ ...style, background: focused ? "var(--surface-alt)" : undefined }}>
              <Checkbox size="small" sx={{ p: 0.25, mr: 0.5 }} checked={isSelected} />
              <span className="text-[13px]">{option}</span>
            </li>
          );
        }}
        renderInput={(params) => <TextField {...params} placeholder={selected.length === 0 ? placeholder : undefined} />}
      />
    </VirtualScrollContext.Provider>
  );
}

/** "01", "001" and "1" are one lot: the comparable form of a typed lot number (mirrors the server's LotSearch.NormalizeLot). */
function lotKey(s: string): string {
  const t = s.trim();
  if (/^\d+$/.test(t)) return t.replace(/^0+/, "") || "0";
  return t.toLowerCase();
}

/**
 * Specific lots, TYPED rather than picked: a sale has thousands of lot numbers, and listing them made the page laggy. The
 * user types numbers (separated by comma, space or Enter - a pasted list works too); each becomes a chip, and they are
 * matched on the server when Search is pressed, where 1, 01 and 001 are the same lot. A number typed but not yet
 * confirmed is added when the box loses focus, so clicking Search straight after typing still includes it.
 */
function TypedLotInput({
  selected,
  onChange,
  placeholder,
}: {
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder: string;
}) {
  const [input, setInput] = useState("");
  const add = (tokens: string[]) => {
    const merged = [...selected];
    for (const token of tokens) if (!merged.some((v) => lotKey(v) === lotKey(token))) merged.push(token.trim());
    if (merged.length !== selected.length) onChange(merged);
  };
  return (
    <Autocomplete
      multiple
      freeSolo
      autoSelect
      size="small"
      options={[]}
      value={selected}
      inputValue={input}
      onChange={(_, values) => {
        // Enter / blur adds the typed text; removing a chip shrinks the list. Either way keep each lot once.
        const seen = new Set<string>();
        onChange(values.map((v) => v.trim()).filter((v) => v && !seen.has(lotKey(v)) && seen.add(lotKey(v))));
      }}
      onInputChange={(_, value, reason) => {
        if (reason !== "input") {
          setInput(value);
          return;
        }
        // A comma / space / semicolon ends a number: everything before the last separator is added, the rest stays typed.
        if (/[\s,;]/.test(value)) {
          const parts = value.split(/[\s,;]+/);
          const rest = /[\s,;]$/.test(value) ? "" : (parts.pop() ?? "");
          add(parts.filter(Boolean));
          setInput(rest);
        } else {
          setInput(value);
        }
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
  saleOptions,
  saleValue,
  saleMultiLabel,
  onSaleChange,
  serverOptions,
  onSearch,
  toolbar,
  bodyMaxHeight,
  searchPending,
  allowAllYears = true,
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
  /**
   * Catalogue Manager only: a Sale dropdown right after Year. Lists the sales of the chosen year
   * (every sale when Year is "All"), newest first - the first one is tagged "latest". Picking a Year
   * lands on that year's latest sale; this lets the user step to another sale of the same year.
   * Omit to hide it (the Valuation pages use this panel without it).
   */
  saleOptions?: { id: string; label: string }[];
  /** The selected sale's id, or "" when several sales are pooled (then `saleMultiLabel` is shown). */
  saleValue?: string;
  saleMultiLabel?: string | null;
  onSaleChange?: (id: string) => void;
  /**
   * Catalogue Manager search mode: the dropdown option lists, computed on the server (the browser holds no lots
   * to derive them from). When given, `lots` is not used for options and the lists don't narrow as other filters
   * change — the user sets the filters, then presses Search.
   */
  serverOptions?: Record<string, string[]>;
  /** Shows a Search button in the panel header (and Enter in a text field runs it). */
  onSearch?: () => void;
  /** Extra buttons (Download, Columns) shown in the Search button's cell, to its left. */
  toolbar?: ReactNode;
  /** Cap the filter fields' height (CSS length); they scroll inside it so the results grid keeps its room. The header row stays visible. */
  bodyMaxHeight?: string;
  /** Show an "All" entry in the Year dropdown. The Catalogue Manager turns it off: there Year picks which sales are listed. */
  allowAllYears?: boolean;
  /** Filters were changed since the last search — highlights the Search button. */
  searchPending?: boolean;
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
        return header
          ? { def, header, options: serverOptions ? (serverOptions[header] ?? []) : columnOptions(lotsFor(header), header) }
          : null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null && x.options.length > 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, lots, isValuation, dColumnFilters, dStatus, dClassification, dYear, serverOptions]);

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
        ? [...(serverOptions ? (serverOptions[lotNoHeader] ?? []) : columnOptions(lotsFor(lotNoHeader), lotNoHeader))].sort(
            (a, b) => (parseFloat(a) || 0) - (parseFloat(b) || 0)
          )
        : [],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [lots, lotNoHeader, dColumnFilters, dStatus, dClassification, dYear, serverOptions]
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
    // Newest year first, so the year to pick most often is at the top.
    return [...new Set([...loaded, ...known])].sort().reverse();
  }, [lots, dColumnFilters, dStatus, dClassification, allYears]);

  const selectedOf = (header: string): string[] => {
    const f = columnFilters[header];
    return f?.kind === "categorical" ? f.values : [];
  };

  // The buttons sit in the last cells of the dropdown grid, level with the final filter row. Whether they fit there depends on
  // how many columns the panel's width gives: pick the narrowest-acceptable column width (200 down to 150px) that leaves at
  // least three free cells after the last dropdown, so they never spill onto a line of their own.
  const dropdownGridRef = useRef<HTMLDivElement>(null);
  const [gridMin, setGridMin] = useState(200);
  const dropdownCount = curated.length + (extraCategoricalHeaders?.length ?? 0);
  useEffect(() => {
    const el = dropdownGridRef.current;
    if (!el) return;
    const fit = () => {
      const width = el.clientWidth - 32; // the grid's own side padding
      let chosen = 200;
      for (let m = 200; m >= 150; m -= 5) {
        const cols = Math.max(1, Math.floor((width + 14) / (m + 14)));
        const free = cols - (dropdownCount % cols || cols);
        if (cols >= 4 && free >= 3) {
          chosen = m;
          break;
        }
      }
      setGridMin(chosen);
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(el);
    return () => observer.disconnect();
  }, [dropdownCount]);

  const toggleTick = (header: string, option: string) => {
    const selected = selectedOf(header);
    const values = selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option];
    onColumnFilterChange(header, { kind: "categorical", values });
  };

  return (
    <div
      className="border border-border rounded-md bg-surface-sunken mb-3"
      onKeyDown={(e) => {
        // Enter in any filter box runs the search - unless the key was already used: a type-ahead with its list open and
        // a row highlighted takes Enter to PICK that row (and calls preventDefault), so it never reaches here as a search.
        const t = e.target as HTMLElement;
        if (onSearch && e.key === "Enter" && t.tagName === "INPUT" && !e.isDefaultPrevented()) onSearch();
      }}
    >
      <div className="flex items-center justify-between px-4 pt-3.5 pb-1">
        <h4 className="font-display text-[14px] font-semibold text-text m-0">Filters</h4>
      </div>

      <div style={{ maxHeight: bodyMaxHeight, overflowY: bodyMaxHeight ? "auto" : undefined }}>
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
            <FieldLabel>{serverOptions ? "Specific Lots (type numbers)" : "Specific Lots (added to range)"}</FieldLabel>
            {serverOptions ? (
              <TypedLotInput
                selected={lotFilter.values}
                onChange={(values) => onColumnFilterChange(lotNoHeader, { ...lotFilter, values })}
                placeholder="e.g. 5, 12, 001"
              />
            ) : (
              <PickAutocomplete
                options={lotOptions}
                selected={lotFilter.values}
                onChange={(values) => onColumnFilterChange(lotNoHeader, { ...lotFilter, values })}
                placeholder="Pick lots from anywhere"
              />
            )}
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
              {allowAllYears && <MenuItem value="">All</MenuItem>}
              {years.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        {saleOptions && onSaleChange && (
          <div className="min-w-[200px]">
            <FieldLabel>Sale</FieldLabel>
            <FormControl size="small" fullWidth>
              <Select
                value={saleValue ?? ""}
                displayEmpty
               
                onChange={(e) => onSaleChange(e.target.value)}
                renderValue={(v) =>
                  v ? (saleOptions.find((o) => o.id === v)?.label ?? "") : (saleMultiLabel ?? "Select a sale")
                }
              >
                {saleOptions.map((o, i) => (
                  <MenuItem key={o.id} value={o.id}>
                    {o.label}
                    {i === 0 ? " · latest" : ""}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </div>
        )}
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
        ref={dropdownGridRef}
        className="grid gap-x-3.5 gap-y-3 px-4 pb-4"
        style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${gridMin}px, 1fr))` }}
      >
        {(extraCategoricalHeaders ?? []).map((header) => (
          <div key={`extra-${header}`}>
            <FieldLabel>{header}</FieldLabel>
            <PickAutocomplete
              options={serverOptions ? (serverOptions[header] ?? []) : columnOptions(lotsFor(header), header)}
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
        {onSearch && (
          // Level with the last filter row (Selling Mark), bottom right: the last cells of the grid, so it costs no extra line.
          <div className="flex items-end justify-end gap-2" style={{ gridColumn: "-4 / -1" }}>
            {toolbar}
            <Button
              variant={searchPending ? "contained" : "outlined"}
              startIcon={<SearchIcon />}
              onClick={onSearch}
              sx={{ px: 3, height: 40, fontSize: 15 }}
            >
              Search
            </Button>
            <button
              type="button"
              onClick={onClearAll}
              className="text-[13px] text-text-muted underline hover:text-liquor bg-transparent border-none cursor-pointer pb-2.5"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
      </div>
    </div>
  );
}
