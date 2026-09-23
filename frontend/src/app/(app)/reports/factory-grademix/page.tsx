"use client";

import CompareView from "@/components/reports/factory-grademix/CompareView";
import FactorySheet from "@/components/reports/factory-grademix/FactorySheet";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api, ApiError } from "@/lib/api";
import type { FactoryGrademixReport, GrademixCompareFactory, GrademixFactoryOption, GrademixSaleOption } from "@/types/api";
import CloseIcon from "@mui/icons-material/Close";
import PrintOutlinedIcon from "@mui/icons-material/PrintOutlined";
import SlideshowOutlinedIcon from "@mui/icons-material/SlideshowOutlined";
import Autocomplete from "@mui/material/Autocomplete";
import Button from "@mui/material/Button";
import FormControlLabel from "@mui/material/FormControlLabel";
import MenuItem from "@mui/material/MenuItem";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import { useEffect, useMemo, useRef, useState } from "react";

const MAX_PEERS = 4;

/** Loads factory options for an Autocomplete as the user types (debounced). */
function useFactoryOptions(input: string) {
  const [options, setOptions] = useState<GrademixFactoryOption[]>([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let live = true;
    setLoading(true);
    const t = setTimeout(() => {
      api
        .searchGrademixFactories(input)
        .then((r) => live && setOptions(r))
        .catch(() => live && setOptions([]))
        .finally(() => live && setLoading(false));
    }, 250);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [input]);
  return { options, loading };
}

const optionLabel = (o: GrademixFactoryOption) => `${o.name} (${o.code})`;

export default function FactoryGrademixPage() {
  const [tab, setTab] = useState<"sheet" | "compare">("sheet");
  const [factory, setFactory] = useState<GrademixFactoryOption | null>(null);
  const [peers, setPeers] = useState<GrademixFactoryOption[]>([]);
  const [sales, setSales] = useState<GrademixSaleOption[]>([]);
  const [saleKey, setSaleKey] = useState(""); // "" = latest sale with results
  const [months, setMonths] = useState(6);
  const [hidePeers, setHidePeers] = useState(false);
  const [presenting, setPresenting] = useState(false);

  const [mainInput, setMainInput] = useState("");
  const [peerInput, setPeerInput] = useState("");
  const main = useFactoryOptions(mainInput);
  const peerOpts = useFactoryOptions(peerInput);

  const [report, setReport] = useState<FactoryGrademixReport | null>(null);
  const [compare, setCompare] = useState<GrademixCompareFactory[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    api.listGrademixSales().then(setSales).catch(() => setSales([]));
  }, []);

  const saleParams = useMemo(() => {
    if (!saleKey) return {};
    const [y, n] = saleKey.split("-").map(Number);
    return { year: y, saleNo: n };
  }, [saleKey]);

  // One request in flight at a time: switching factory/sale/tab quickly must not let a slow
  // earlier response overwrite a newer one.
  useEffect(() => {
    if (!factory) {
      setReport(null);
      setCompare(null);
      return;
    }
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    const run =
      tab === "sheet"
        ? api.getFactoryGrademix(factory.code, { ...saleParams, months }).then((r) => id === requestId.current && setReport(r))
        : api
            .compareGrademixFactories([factory.code, ...peers.map((p) => p.code)], { ...saleParams, months })
            .then((r) => id === requestId.current && setCompare(r));
    run
      .catch((e) => {
        if (id !== requestId.current) return;
        setError(e instanceof ApiError ? e.message : "Couldn't build this report");
        if (tab === "sheet") setReport(null);
        else setCompare(null);
      })
      .finally(() => id === requestId.current && setLoading(false));
  }, [factory, peers, tab, saleParams, months]);

  useEffect(() => {
    if (!presenting) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setPresenting(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [presenting]);

  const body = !factory ? (
    <div className="border border-dashed border-border rounded-[var(--radius-lg)] p-10 text-center text-[14px] text-text-muted">
      Pick a factory to build its sheet — last sale, month by month, and what to expect next sale.
    </div>
  ) : loading ? (
    <div className="flex flex-col items-center gap-3 py-16">
      <TeaLoader size={44} />
      <span className="text-[12.5px] text-text-muted">Reading the sale files — the first factory after a restart takes a little longer.</span>
    </div>
  ) : error ? (
    <div className="p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
  ) : tab === "sheet" && report ? (
    <FactorySheet report={report} />
  ) : tab === "compare" && compare ? (
    compare.length < 2 ? (
      <div className="border border-dashed border-border rounded-[var(--radius-lg)] p-8 text-center text-[13.5px] text-text-muted">
        Add up to {MAX_PEERS} factories to compare against.
      </div>
    ) : (
      <CompareView items={compare} hidePeers={hidePeers} />
    )
  ) : null;

  return (
    <div>
      <div className="print:hidden">
        <PageHeader
          title="Factory Grademix"
          subtitle="Show a factory how it performed last sale, month by month, and what to expect next sale — in the company's grademix layout."
          backTo={{ href: "/reports", label: "Reports" }}
          actions={
            <div className="flex gap-2">
              <Button size="small" variant="outlined" startIcon={<PrintOutlinedIcon fontSize="small" />} onClick={() => window.print()} disabled={!report && !compare}>
                Print
              </Button>
              <Button size="small" variant="contained" startIcon={<SlideshowOutlinedIcon fontSize="small" />} onClick={() => setPresenting(true)} disabled={!factory}>
                Present
              </Button>
            </div>
          }
        />

        <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
          <div className="flex flex-wrap items-end gap-3">
            <Autocomplete
              size="small"
              sx={{ width: 340, maxWidth: "100%" }}
              options={main.options}
              loading={main.loading}
              value={factory}
              onChange={(_, v) => setFactory(v)}
              onInputChange={(_, v, reason) => reason !== "reset" && setMainInput(v)}
              getOptionLabel={optionLabel}
              isOptionEqualToValue={(a, b) => a.code === b.code}
              filterOptions={(o) => o}
              renderInput={(p) => <TextField {...p} label="Factory" placeholder="Type a name or code" />}
              renderOption={(props, o) => (
                <li {...props} key={o.code}>
                  <span>
                    {o.name} <span className="text-text-muted text-[12px]">· {o.code}{o.elevationLabel ? ` · ${o.elevationLabel}` : ""}</span>
                  </span>
                </li>
              )}
            />
            <TextField select size="small" label="Sale" value={saleKey} onChange={(e) => setSaleKey(e.target.value)} sx={{ width: 190 }}>
              <MenuItem value="">Latest with results</MenuItem>
              {sales.map((s) => (
                <MenuItem key={`${s.year}-${s.saleNo}`} value={`${s.year}-${s.saleNo}`}>
                  Sale {s.saleNo} · {s.year}
                </MenuItem>
              ))}
            </TextField>
            <TextField select size="small" label="Trend shown" value={months} onChange={(e) => setMonths(Number(e.target.value))} sx={{ width: 160 }}>
              <MenuItem value={0}>This sale only</MenuItem>
              {[3, 6, 9, 12].map((m) => (
                <MenuItem key={m} value={m}>{m} months</MenuItem>
              ))}
            </TextField>
            <div className="inline-flex rounded-full border border-border overflow-hidden" role="tablist" aria-label="View">
              {(["sheet", "compare"] as const).map((t) => (
                <button
                  key={t}
                  role="tab"
                  aria-selected={tab === t}
                  onClick={() => setTab(t)}
                  className="px-4 py-1.5 text-[13px] font-semibold border-0 cursor-pointer"
                  style={{ background: tab === t ? "var(--brand-olive-deep)" : "var(--surface)", color: tab === t ? "#fff" : "var(--text)" }}
                >
                  {t === "sheet" ? "Factory sheet" : "Compare factories"}
                </button>
              ))}
            </div>
          </div>

          {tab === "compare" && (
            <div className="flex flex-wrap items-center gap-3 mt-3">
              <Autocomplete
                multiple
                size="small"
                sx={{ width: 520, maxWidth: "100%" }}
                options={peerOpts.options.filter((o) => o.code !== factory?.code)}
                loading={peerOpts.loading}
                value={peers}
                onChange={(_, v) => setPeers(v.slice(0, MAX_PEERS))}
                onInputChange={(_, v, reason) => reason !== "reset" && setPeerInput(v)}
                getOptionLabel={optionLabel}
                isOptionEqualToValue={(a, b) => a.code === b.code}
                filterOptions={(o) => o}
                renderInput={(p) => <TextField {...p} label={`Compare against (up to ${MAX_PEERS})`} placeholder="Add a factory" />}
              />
              <FormControlLabel
                control={<Switch size="small" checked={hidePeers} onChange={(e) => setHidePeers(e.target.checked)} />}
                label={<span className="text-[13px]">Hide peer names</span>}
              />
            </div>
          )}
        </div>
      </div>

      {presenting ? (
        <div className="fixed inset-0 z-[1300] overflow-auto px-6 py-5 print:static" style={{ background: "var(--surface-alt)" }}>
          <div className="max-w-[1280px] mx-auto" style={{ zoom: 1.1 }}>
            <div className="flex justify-end mb-2 print:hidden">
              <Button size="small" variant="outlined" startIcon={<CloseIcon fontSize="small" />} onClick={() => setPresenting(false)}>
                Exit (Esc)
              </Button>
            </div>
            {body}
          </div>
        </div>
      ) : (
        body
      )}

      <style>{`@media print { @page { size: A4 landscape; margin: 8mm; } }`}</style>
    </div>
  );
}
