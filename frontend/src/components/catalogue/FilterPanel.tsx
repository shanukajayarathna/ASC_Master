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
import { useDeferredValue, useMemo, useRef, useState, type ReactNode } from "react";

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
    <label
      className="block font-semibold tracking-wide text-text-strong mb-1 truncate"
      title={typeof children === "string" ? children : undefined}
      style={{ fontSize: "clamp(9px, 0.85vw, 12px)", lineHeight: 1.2 }}
    >
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
  allowCustom = false,
}: {
  options: string[];
  selected: string[];
  onChange: (values: string[]) => void;
  placeholder?: string;
  allowCustom?: boolean;
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
        freeSolo={allowCustom}
        autoSelect={allowCustom}
        size="small"
        sx={{
          // Keep the selected chip, input and MUI's clear/dropdown controls on one
          // line. Without this, a long selection wraps the controls below the chip
          // and makes the filter field grow vertically.
          "& .MuiAutocomplete-inputRoot": {
            flexWrap: "nowrap",
            overflow: "hidden",
            minHeight: 40,
            pr: "64px !important",
          },
          "& .MuiAutocomplete-tag": {
            flex: "0 1 auto",
            minWidth: 0,
            maxWidth: "calc(100% - 8px)",
          },
          "& .MuiAutocomplete-tag .MuiChip-label": {
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontSize: "clamp(9px, 0.85vw, 12px)",
          },
          "& .MuiAutocomplete-input": { minWidth: "0 !important", width: 0, flexGrow: 1, fontSize: "clamp(9px, 0.85vw, 12px)" },
          "& .MuiAutocomplete-endAdornment": { right: 8 },
        }}
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
      sx={{ "& .MuiInputBase-input": { fontSize: "clamp(9px, 0.85vw, 12px)" } }}
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
  searchDisabled = false,
  toolbar,
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
   *  is still pickable; the Catalogue Reports page loads the chosen sale on Search. */
  allYears?: number[];
  /**
   * Catalogue Reports only: a Sale dropdown right after Year. Lists the sales of the chosen year
   * (every sale when Year is "All"), newest first - the first one is tagged "latest". Picking a Year
   * selects that year's latest sale; Search loads it after the user finishes choosing filters.
   * Omit to hide it (the Valuation pages use this panel without it).
   */
  saleOptions?: { id: string; label: string }[];
  /** The selected sale's id, or "" when several sales are pooled (then `saleMultiLabel` is shown). */
  saleValue?: string;
  saleMultiLabel?: string | null;
  onSaleChange?: (id: string) => void;
  /**
   * Catalogue Reports search mode: the dropdown option lists, computed on the server (the browser holds no lots
   * to derive them from). When given, `lots` is not used for options and the lists don't narrow as other filters
   * change — the user sets the filters, then presses Search.
   */
  serverOptions?: Record<string, string[]>;
  /** Shows a Search button in the panel header (and Enter in a text field runs it). */
  onSearch?: () => void;
  /** Disable applying filters while the selected sale or another search is loading. */
  searchDisabled?: boolean;
  /** Extra buttons (Download, Columns) shown in the Search button's cell, to its left. */
  toolbar?: ReactNode;
  /** Show an "All" entry in the Year dropdown. The Catalogue Reports turns it off: there Year picks which sales are listed. */
  allowAllYears?: boolean;
  /** Filters were changed since the last search — highlights the Search button. */
  searchPending?: boolean;
  onClearAll: () => void;
  /**
   * "valuation" tailors the panel to the Valuation Centre: the Invoice No dropdown
   * becomes a free-text search. (Lot Number always gets its own range + pick-any-lot
   * controls, in every variant — see lotNoHeader.)
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
      // A column genuinely absent from the sale is hidden (nothing to filter by, ever) - but only once that is actually
      // known. In server mode, an empty options list usually just means the still-streaming sale hasn't reached a row with
      // that value YET, not that the column is empty: hiding the field then showing it once its first value arrives made
      // filters pop in one at a time as the sale loaded, reflowing the whole panel. The column list itself (`headers`)
      // already reflects the real sale, so a header that resolved at all is shown from the start; its own dropdown just
      // grows richer as more of the sale arrives, same as any of the others.
      .filter((x): x is NonNullable<typeof x> => x !== null && (x.options.length > 0 || serverOptions !== undefined));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [headers, lots, isValuation, dColumnFilters, dStatus, dClassification, dYear, serverOptions]);

  // Tick groups (Sale Status, Reprint, Rainforest) — rendered right after the curated
  // dropdowns, i.e. after Selling Mark. Not offered while valuing.
  const ticks = useMemo(
    () =>
      isValuation
        ? []
        : TICK_FILTERS.map((def) => ({ def, header: resolveHeader(headers, def.patterns) })).filter(
            (x): x is { def: (typeof TICK_FILTERS)[number]; header: string } => x.header !== null
          ),
    [headers, isValuation]
  );

  const toggleTick = (header: string, option: string) => {
    const selected = selectedOf(header);
    const values = selected.includes(option) ? selected.filter((v) => v !== option) : [...selected, option];
    onColumnFilterChange(header, { kind: "categorical", values });
  };

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
    // Catalogue Reports gets the complete year list from the catalogue index. Its
    // lots can contain tens of thousands of rows, so don't rescan them whenever a
    // draft filter changes just to populate a year menu that already has its data.
    if (serverOptions && allYears) return [...new Set(allYears.map(String))].sort().reverse();
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
  }, [lots, dColumnFilters, dStatus, dClassification, allYears, serverOptions]);

  const selectedOf = (header: string): string[] => {
    const f = columnFilters[header];
    return f?.kind === "categorical" ? f.values : [];
  };

  const filterFieldCount =
    ticks.length +
    (lotNoHeader ? 2 : 0) +
    (invoiceHeader ? 1 : 0) +
    1 + // Year
    (saleOptions && onSaleChange ? 1 : 0) +
    2 + // Ticket Status and Classification
    (extraCategoricalHeaders?.length ?? 0) +
    curated.length;
  // The three tick groups each use two cells on the final row. The actions use
  // the last three cells, spreading both groups across the available width.
  const actionSlots = onSearch ? 3 : 0;
  const gridColumns = Math.max(onSearch ? 3 : 1, Math.ceil((filterFieldCount + ticks.length + actionSlots) / 3));

  return (
    <div
      className={`catalogue-filter-panel border border-border rounded-md bg-surface-sunken mb-2 ${onSearch ? "catalogue-report-filter" : ""}`}
      onKeyDown={(e) => {
        // Enter in any filter box runs the search - unless the key was already used: a type-ahead with its list open and
        // a row highlighted takes Enter to PICK that row (and calls preventDefault), so it never reaches here as a search.
        const t = e.target as HTMLElement;
        if (e.key === "Enter" && t.closest(".MuiAutocomplete-root") && (t as HTMLInputElement).value?.trim()) return;
        if (onSearch && !searchDisabled && e.key === "Enter" && t.tagName === "INPUT" && !e.isDefaultPrevented()) onSearch();
      }}
    >
      {/* Every control shares one responsive grid so columns stay aligned as the
          available width changes. */}
      <div
        className="catalogue-filter-grid grid items-start gap-x-3 gap-y-2.5 px-3.5 pt-2.5 pb-3"
        style={{
          gridTemplateColumns: `repeat(${gridColumns}, minmax(0, var(--catalogue-filter-column-width, 1fr)))`,
          columnGap: "clamp(3px, 0.8vw, 12px)",
          rowGap: "clamp(5px, 0.65vw, 10px)",
        }}
      >
        {lotNoHeader && (
          <div className="min-w-0">
            <FieldLabel>Lot No Range</FieldLabel>
            <div className="flex min-w-0 items-center gap-1.5">
              <TextField
                size="small"
                placeholder="From"
                value={lotFilter.min}
                sx={{ flex: 1, minWidth: 0, "& .MuiInputBase-input": { fontSize: "clamp(9px, 0.85vw, 12px)" } }}
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
                sx={{ flex: 1, minWidth: 0, "& .MuiInputBase-input": { fontSize: "clamp(9px, 0.85vw, 12px)" } }}
                slotProps={{ htmlInput: { inputMode: "numeric" } }}
                onChange={(e) =>
                  onColumnFilterChange(lotNoHeader, { ...lotFilter, max: e.target.value.replace(/\D/g, "") })
                }
              />
            </div>
          </div>
        )}
        {lotNoHeader && (
          <div className="min-w-0">
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
          <div className="min-w-0">
            <FieldLabel>Invoice No</FieldLabel>
            <TextField
              size="small"
              fullWidth
              sx={{ "& .MuiInputBase-input": { fontSize: "clamp(9px, 0.85vw, 12px)" } }}
              placeholder="Type to match"
              value={invoiceValue}
              onChange={(e) => onColumnFilterChange(invoiceHeader, { kind: "text", value: e.target.value })}
            />
          </div>
        )}
        <div className="min-w-0">
          <FieldLabel>Year</FieldLabel>
          <FormControl size="small" fullWidth>
            <Select value={year} displayEmpty onChange={(e) => onYearChange(e.target.value)} sx={{ fontSize: "clamp(9px, 0.85vw, 12px)" }}>
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
          <div className="min-w-0">
            <FieldLabel>Sale</FieldLabel>
            <FormControl size="small" fullWidth>
              <Select
                value={saleValue ?? ""}
                displayEmpty
                sx={{ fontSize: "clamp(9px, 0.85vw, 12px)" }}
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
        <div className="min-w-0">
          <FieldLabel>Ticket Status</FieldLabel>
          <FormControl size="small" fullWidth>
            <Select value={status} onChange={(e) => onStatusChange(e.target.value as TicketStatus | "")} sx={{ fontSize: "clamp(9px, 0.85vw, 12px)" }}>
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        <div className="min-w-0">
          <FieldLabel>Classification</FieldLabel>
          <FormControl size="small" fullWidth>
            <Select value={classification} onChange={(e) => onClassificationChange(e.target.value)} sx={{ fontSize: "clamp(9px, 0.85vw, 12px)" }}>
              {CLASSIFICATION_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  {o.label}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </div>
        {/* Curated type-ahead dropdowns. */}
        {(extraCategoricalHeaders ?? []).map((header) => (
          <div key={`extra-${header}`} className="min-w-0">
            <FieldLabel>{header}</FieldLabel>
            <PickAutocomplete
              options={serverOptions ? (serverOptions[header] ?? []) : columnOptions(lotsFor(header), header)}
              selected={selectedOf(header)}
              onChange={(values) => onColumnFilterChange(header, { kind: "categorical", values })}
              allowCustom={serverOptions !== undefined}
            />
          </div>
        ))}
        {curated.map(({ def, header, options }) => (
          <div key={def.label} className="min-w-0">
            <FieldLabel>{def.label}</FieldLabel>
            <PickAutocomplete
              options={options}
              selected={selectedOf(header)}
              onChange={(values) => onColumnFilterChange(header, { kind: "categorical", values })}
              allowCustom={serverOptions !== undefined}
            />
          </div>
        ))}
        {ticks.map(({ def, header }) => {
          const selected = selectedOf(header);
          return (
            <div key={def.label} className="min-w-0" style={{ gridColumn: "span 2" }}>
              <FieldLabel>{def.label}</FieldLabel>
              <div className="flex whitespace-nowrap gap-x-1 items-center">
                {def.options.map((opt) => (
                  <label key={opt} className="flex items-center gap-0.5 text-[clamp(9px,0.85vw,12px)] text-text cursor-pointer select-none">
                    <Checkbox
                      size="small"
                      sx={{ p: 0, "& .MuiSvgIcon-root": { fontSize: "clamp(14px, 1.1vw, 18px)" } }}
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
        {onSearch && (
          <div
            className="catalogue-filter-actions flex flex-nowrap min-w-0 items-center justify-end gap-1 pt-5 text-[clamp(9px,0.85vw,12px)]"
            style={{ gridColumn: `${gridColumns - 2} / -1`, gridRow: 3 }}
          >
            {toolbar}
            <Button
              variant={searchPending ? "contained" : "outlined"}
              startIcon={<SearchIcon />}
              onClick={onSearch}
              disabled={searchDisabled}
              sx={{ px: 1.5, height: 40, fontSize: "clamp(11px, 0.95vw, 14px)" }}
            >
              Search
            </Button>
            <button
              type="button"
              onClick={onClearAll}
              className="text-[13px] text-text-muted underline hover:text-liquor bg-transparent border-none cursor-pointer"
            >
              Clear all
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
