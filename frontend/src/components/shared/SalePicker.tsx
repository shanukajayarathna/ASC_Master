"use client";

import { useCatalogue } from "@/context/CatalogueContext";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import { useMemo, useState } from "react";

/** "Sale 40 - 2026" -> "Sale 40": the Year dropdown beside the sale picker already says the year. */
export function shortSaleName(sourceName: string): string {
  const m = /Sale\s+(\d+)/i.exec(sourceName);
  return m ? `Sale ${m[1]}` : sourceName;
}

/**
 * Year + Sale dropdowns that choose the app's active sale (shared with the header, the Catalogue Manager and every page that
 * reads the active sale). Pick a year to list that year's sales, then pick the sale.
 */
export default function SalePicker({ className }: { className?: string }) {
  const { catalogues, activeCatalogueId, selectCatalogue, refreshList } = useCatalogue();
  const activeCatalogue = catalogues.find((c) => c.id === activeCatalogueId) ?? null;
  // Every year that actually has a sale on file, newest first - independent of which sale is active.
  const years = useMemo(() => Array.from(new Set(catalogues.map((c) => c.year))).sort((a, b) => b - a), [catalogues]);
  // The year being browsed: follows the active sale until the user opens a different year, and resets once they pick a sale.
  const [browsingYear, setBrowsingYear] = useState<number | null>(null);
  const pickerYear = browsingYear ?? activeCatalogue?.year ?? years[0] ?? null;
  const salesForYear = catalogues.filter((c) => c.year === pickerYear);

  return (
    <div className={className ?? "flex gap-1.5 min-w-0"}>
      <Select
        size="small"
        value={pickerYear ?? ""}
        onChange={(e) => setBrowsingYear(Number(e.target.value))}
        // Rescan as the picker opens, so a sale that appeared while this tab was open shows up exactly when it matters.
        onOpen={() => refreshList()}
        displayEmpty
        disabled={years.length === 0}
        sx={{ width: 92, fontSize: 13, flexShrink: 0 }}
      >
        {years.length === 0 && (
          <MenuItem value="" disabled>
            No years
          </MenuItem>
        )}
        {years.map((y) => (
          <MenuItem key={y} value={y}>
            {y}
          </MenuItem>
        ))}
      </Select>
      <Select
        size="small"
        value={activeCatalogue?.year === pickerYear ? (activeCatalogueId ?? "") : ""}
        onChange={(e) => {
          selectCatalogue(e.target.value || null);
          setBrowsingYear(null);
        }}
        onOpen={() => refreshList()}
        displayEmpty
        disabled={salesForYear.length === 0}
        sx={{ width: "100%", fontSize: 13, minWidth: 110 }}
        renderValue={(v) => {
          if (!v) return <span className="text-text-muted">Choose a sale</span>;
          const c = catalogues.find((x) => x.id === v);
          return c ? shortSaleName(c.sourceName) : "…";
        }}
      >
        {salesForYear.length === 0 && (
          <MenuItem value="" disabled>
            No sales for this year
          </MenuItem>
        )}
        {salesForYear.map((c) => (
          <MenuItem key={c.id} value={c.id}>
            {shortSaleName(c.sourceName)}
          </MenuItem>
        ))}
      </Select>
    </div>
  );
}
