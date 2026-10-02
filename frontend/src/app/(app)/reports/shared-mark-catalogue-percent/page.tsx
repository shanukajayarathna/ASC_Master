"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api, ApiError } from "@/lib/api";
import { BROKER_SHORT_CODES_ORDERED, brokerColorVarByShortCode, brokerPaletteCss } from "@/lib/brokers";
import type { SharedMarkCataloguePercent } from "@/types/api";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import ToggleButton from "@mui/material/ToggleButton";
import ToggleButtonGroup from "@mui/material/ToggleButtonGroup";
import { useEffect, useMemo, useState } from "react";

const SALE_NAME = /^Sale (\d+) - (\d+)$/;
const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

type Mode = "sale" | "month" | "year" | "range";

export default function SharedMarkCataloguePercentPage() {
  const { catalogues } = useCatalogue();

  // Every sale on file, newest first by sale year then sale number — not by import time.
  // Unlike Category Average Trend this doesn't require saleDateEnd: catalogued quantity is
  // meaningful the moment a sale's file is imported, whether or not it has sold yet.
  const sales = useMemo(
    () =>
      catalogues
        .map((c) => ({ id: c.id, name: c.sourceName, year: c.year, no: Number(SALE_NAME.exec(c.sourceName)?.[1] ?? NaN) }))
        .filter((s) => Number.isFinite(s.no))
        .sort((a, b) => b.year - a.year || b.no - a.no),
    [catalogues],
  );

  const years = useMemo(() => Array.from(new Set(catalogues.map((c) => c.year))).sort((a, b) => b - a), [catalogues]);

  const [mode, setMode] = useState<Mode>("sale");
  const [saleId, setSaleId] = useState("");
  const [year, setYear] = useState<number | "">("");
  const [month, setMonth] = useState<number | "">("");
  const [fromSaleId, setFromSaleId] = useState("");
  const [toSaleId, setToSaleId] = useState("");
  // Off by default: a re-catalogued lot would otherwise double-count. On reconciles against a
  // source with no reprint flag of its own (e.g. the MSL archive).
  const [includeReprints, setIncludeReprints] = useState(false);

  // Fall back to the newest sale/year until the user picks one — derived rather than set via an
  // effect, so there's no extra render just to seed a default.
  const effectiveSaleId = saleId || sales[0]?.id || "";
  const effectiveYear = (year !== "" ? year : (years[0] ?? "")) as number | "";

  // Months that actually have a sale on file for the chosen year, so Month mode never offers
  // an empty selection.
  const monthsForYear = useMemo(() => {
    if (effectiveYear === "") return [];
    const months = new Set(
      catalogues.filter((c) => c.year === effectiveYear).map((c) => new Date(c.importedAt).getMonth() + 1),
    );
    return Array.from(months).sort((a, b) => a - b);
  }, [catalogues, effectiveYear]);

  const [data, setData] = useState<SharedMarkCataloguePercent | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const params = useMemo((): Parameters<typeof api.getSharedMarkCataloguePercent>[0] | null => {
    if (mode === "sale") return effectiveSaleId ? { mode, catalogueId: effectiveSaleId, includeReprints } : null;
    if (mode === "year") return effectiveYear !== "" ? { mode, year: effectiveYear, includeReprints } : null;
    if (mode === "month") return effectiveYear !== "" && month !== "" ? { mode, year: effectiveYear, month, includeReprints } : null;
    if (mode === "range")
      return fromSaleId && toSaleId ? { mode, fromCatalogueId: fromSaleId, toCatalogueId: toSaleId, includeReprints } : null;
    return null;
  }, [mode, effectiveSaleId, effectiveYear, month, fromSaleId, toSaleId, includeReprints]);

  useEffect(() => {
    if (!params) {
      // An incomplete scope (e.g. switched to Month/Range and the new picker isn't filled in
      // yet) used to leave the previous scope's table on screen with no indication it's stale.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setData(null);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setData(null);
    setLoading(true);
    setError(null);
    api
      .getSharedMarkCataloguePercent(params)
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setError(e instanceof ApiError ? e.message : "Couldn't build this report"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [params]);

  // Canonical portal-donut order, filtered down to whichever brokers this scope's data actually has.
  const brokerColumns = useMemo(() => (data ? BROKER_SHORT_CODES_ORDERED.filter((c) => data.brokers.includes(c)) : []), [data]);

  return (
    <div>
      <style>{brokerPaletteCss()}</style>
      <PageHeader
        title="Shared Mark Catalogues % Broker-wise"
        subtitle="Every factory catalogued by two or more brokers, and the percentage of its catalogued quantity each broker carried."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
        <div className="flex items-end gap-3 flex-wrap">
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v: Mode | null) => v && setMode(v)}>
            <ToggleButton value="sale">Sale</ToggleButton>
            <ToggleButton value="month">Month</ToggleButton>
            <ToggleButton value="year">Year</ToggleButton>
            <ToggleButton value="range">Range</ToggleButton>
          </ToggleButtonGroup>

          {mode === "sale" && (
            <TextField
              select
              label="Sale"
              size="small"
              value={effectiveSaleId}
              onChange={(e) => setSaleId(e.target.value)}
              sx={{ minWidth: 190 }}
              disabled={sales.length === 0}
            >
              {sales.map((s) => (
                <MenuItem key={s.id} value={s.id}>
                  {s.name}
                </MenuItem>
              ))}
            </TextField>
          )}

          {mode === "month" && (
            <>
              <TextField
                select
                label="Year"
                size="small"
                value={effectiveYear}
                onChange={(e) => {
                  setYear(Number(e.target.value));
                  setMonth("");
                }}
                sx={{ minWidth: 110 }}
                disabled={years.length === 0}
              >
                {years.map((y) => (
                  <MenuItem key={y} value={y}>
                    {y}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="Month"
                size="small"
                value={month}
                onChange={(e) => setMonth(Number(e.target.value))}
                sx={{ minWidth: 150 }}
                disabled={monthsForYear.length === 0}
              >
                {monthsForYear.map((m) => (
                  <MenuItem key={m} value={m}>
                    {MONTH_NAMES[m - 1]}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}

          {mode === "year" && (
            <TextField
              select
              label="Year"
              size="small"
              value={effectiveYear}
              onChange={(e) => setYear(Number(e.target.value))}
              sx={{ minWidth: 110 }}
              disabled={years.length === 0}
            >
              {years.map((y) => (
                <MenuItem key={y} value={y}>
                  {y}
                </MenuItem>
              ))}
            </TextField>
          )}

          {mode === "range" && (
            <>
              <TextField
                select
                label="From sale"
                size="small"
                value={fromSaleId}
                onChange={(e) => setFromSaleId(e.target.value)}
                sx={{ minWidth: 190 }}
                disabled={sales.length === 0}
              >
                {sales.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                select
                label="To sale"
                size="small"
                value={toSaleId}
                onChange={(e) => setToSaleId(e.target.value)}
                sx={{ minWidth: 190 }}
                disabled={sales.length === 0}
              >
                {sales.map((s) => (
                  <MenuItem key={s.id} value={s.id}>
                    {s.name}
                  </MenuItem>
                ))}
              </TextField>
            </>
          )}

          <FormControlLabel
            className="ml-auto"
            control={<Switch size="small" checked={includeReprints} onChange={(e) => setIncludeReprints(e.target.checked)} />}
            label={<span className="text-[13px] text-text-muted">Include reprints</span>}
          />
        </div>
      </div>

      {error && <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>}

      {loading && (
        <div className="flex justify-center py-16">
          <TeaLoader size={48} />
        </div>
      )}

      {!loading && !error && data && data.rows.length === 0 && (
        <div className="text-center py-16 text-text-muted">No factory was catalogued by more than one broker in this scope.</div>
      )}

      {!loading && data && data.rows.length > 0 && (
        <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
          <table className="w-full text-[12.5px] border-collapse min-w-[560px]">
            <thead>
              <tr>
                <th className="font-semibold text-[14px] uppercase tracking-wide text-left px-3 py-2.5 whitespace-nowrap text-white" style={{ background: "#1F3864" }}>
                  Factory
                </th>
                {brokerColumns.map((code) => (
                  <th
                    key={code}
                    className="font-bold text-[15px] uppercase tracking-wide text-center px-3 py-2.5 whitespace-nowrap text-white"
                    style={{ background: brokerColorVarByShortCode(code) }}
                  >
                    {code}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.code}>
                  <td className="px-3 py-2 border-t border-border whitespace-nowrap font-semibold text-[14px] text-text-strong">{row.factoryName}</td>
                  {brokerColumns.map((code) => {
                    const pct = row.percentByBroker[code];
                    return (
                      <td key={code} className="px-3 py-1.5 border-t border-border text-center tabular-nums">
                        {pct !== undefined ? (
                          <span className="text-[16px] font-bold" style={{ color: brokerColorVarByShortCode(code) }}>
                            {pct.toFixed(2)}%
                          </span>
                        ) : (
                          <span className="text-text-muted">—</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
