"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api, ApiError } from "@/lib/api";
import type { CatalogueSummary, CategoryAnalysis, CategoryOption, ScheduledReportOutput } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import CircularProgress from "@mui/material/CircularProgress";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useMemo, useState } from "react";

const TIER_NAMES = ["Select Best", "Best", "Below Best", "Poor"] as const;
const STATUS_COLORS: Record<string, string> = { sold: "#1E7145", outsold: "#C2690F", unsold: "#A62F23" };

function StatCard({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="flex-1 min-w-[150px] rounded-[var(--radius-lg)] border border-border p-3.5" style={{ background: "var(--surface-alt)", borderLeft: `3px solid ${color}` }}>
      <div className="text-[10.5px] font-semibold tracking-wide text-text-muted uppercase">{label}</div>
      <div className="text-[24px] font-bold text-text-strong leading-tight mt-1">{value}</div>
      <div className="text-[11px] text-text-muted mt-0.5">{sub}</div>
    </div>
  );
}

function Table({ children }: { children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[var(--radius-lg)] border border-border">
      <table className="w-full text-[12.5px] border-collapse min-w-[560px]">{children}</table>
    </div>
  );
}

const th = "text-left font-semibold text-[11px] uppercase tracking-wide text-white px-3 py-2 whitespace-nowrap";
const td = "px-3 py-2 border-t border-border whitespace-nowrap";

export default function CategoryAnalysisPage() {
  const [categories, setCategories] = useState<CategoryOption[] | null>(null);
  const [category, setCategory] = useState("");
  const [catalogues, setCatalogues] = useState<CatalogueSummary[] | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const [data, setData] = useState<CategoryAnalysis | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [outputs, setOutputs] = useState<ScheduledReportOutput[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  useEffect(() => {
    api.listCategoryOptions().then((opts) => {
      setCategories(opts);
      const preferred = opts.find((o) => o.category.toLowerCase() === "ex-estate") ?? opts[0];
      if (preferred) setCategory(preferred.category);
    }).catch(() => setCategories([]));
    api.listCatalogues().then((list) => {
      setCatalogues(list);
      setSelectedIds(list.slice(0, 4).map((c) => c.id));
    }).catch(() => setCatalogues([]));
    refreshOutputs();
  }, []);

  const refreshOutputs = () => {
    api.listCategoryAnalysisOutputs().then(setOutputs).catch(() => setOutputs([]));
  };

  const toggleSale = (id: string) => {
    setSelectedIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  };

  const preview = async () => {
    if (!category || selectedIds.length === 0) return;
    setLoadingPreview(true);
    setError(null);
    try {
      const result = await api.previewCategoryAnalysis(category, selectedIds);
      setData(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load this preview");
      setData(null);
    } finally {
      setLoadingPreview(false);
    }
  };

  const generate = async () => {
    if (!category || selectedIds.length === 0) return;
    setGenerating(true);
    setError(null);
    try {
      await api.generateCategoryAnalysis(category, selectedIds);
      refreshOutputs();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't generate this report");
    } finally {
      setGenerating(false);
    }
  };

  const download = async (o: ScheduledReportOutput) => {
    setDownloadingId(o.id);
    try {
      const { blob, fileName } = await api.downloadSavedReport(o.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? `${o.title}.xlsx`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  // Pivot the flagship rows into broker x sale for the on-screen table.
  const pivot = useMemo(() => {
    if (!data) return null;
    const byBroker = new Map<string, Map<string, (typeof data.saleBroker)[number]>>();
    for (const row of data.saleBroker) {
      const key = `${row.saleNo}/${row.saleYear}`;
      if (!byBroker.has(row.broker)) byBroker.set(row.broker, new Map());
      byBroker.get(row.broker)!.set(key, row);
    }
    const brokerOrder = data.brokerDistribution.map((b) => b.broker);
    return { byBroker, brokerOrder };
  }, [data]);

  return (
    <div>
      <PageHeader
        title="Category Analysis"
        subtitle="Price & Classification — Sale x Broker: how any catalogue category (Ex-estate, High & Medium, Off Grade…) is distributed among brokers, how it sold, and how price varies by quality tier."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>}

      <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-1">Generate for a category</h3>
        <p className="text-[12px] text-text-muted m-0 mb-3">
          This also generates itself automatically after each sale closes (rolling last 4 sales, Ex-estate) — use this to
          preview it on-screen, pick your own sales/category, or build the workbook right now.
        </p>

        <div className="flex items-start gap-4 flex-wrap">
          <TextField
            select
            label="Category"
            size="small"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            sx={{ width: 220 }}
            disabled={categories === null}
          >
            {(categories ?? []).map((o) => (
              <MenuItem key={o.category} value={o.category}>
                {o.category} ({o.lotCount})
              </MenuItem>
            ))}
          </TextField>

          <div className="flex-1 min-w-[280px]">
            <div className="text-[11px] font-semibold text-text-muted uppercase tracking-wide mb-1">Sales</div>
            {catalogues === null ? (
              <CircularProgress size={18} />
            ) : catalogues.length === 0 ? (
              <span className="text-[12px] text-text-muted">No sales imported yet.</span>
            ) : (
              <div className="flex flex-wrap gap-x-3 gap-y-0 max-h-[110px] overflow-y-auto pr-2">
                {catalogues.map((c) => (
                  <FormControlLabel
                    key={c.id}
                    control={<Checkbox size="small" checked={selectedIds.includes(c.id)} onChange={() => toggleSale(c.id)} />}
                    label={<span className="text-[12.5px]">{c.sourceName}</span>}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 mt-3">
          <Button
            size="small"
            variant="outlined"
            startIcon={loadingPreview ? <CircularProgress size={14} color="inherit" /> : <VisibilityOutlinedIcon fontSize="small" />}
            onClick={preview}
            disabled={loadingPreview || !category || selectedIds.length === 0}
          >
            {loadingPreview ? "Loading…" : "Preview"}
          </Button>
          <Button
            size="small"
            variant="contained"
            startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlinedIcon fontSize="small" />}
            onClick={generate}
            disabled={generating || !category || selectedIds.length === 0}
          >
            {generating ? "Generating…" : "Generate workbook"}
          </Button>
          <span className="text-[11px] text-text-muted">{selectedIds.length} sale(s) selected</span>
        </div>
      </div>

      {data && (
        <div className="flex flex-col gap-5 mb-5">
          <div className="flex gap-3 flex-wrap">
            <StatCard label="Lots offered" value={data.summary.totalLots.toLocaleString()} sub={`${data.sales.length} sale(s), ${data.summary.brokerCount} brokers`} color="var(--brand-gold)" />
            <StatCard
              label="Sold"
              value={`${data.summary.totalLots ? Math.round((data.summary.sold * 100) / data.summary.totalLots) : 0}%`}
              sub={`${data.summary.sold.toLocaleString()} lots`}
              color={STATUS_COLORS.sold}
            />
            <StatCard
              label="Outsold"
              value={`${data.summary.totalLots ? Math.round((data.summary.outsold * 100) / data.summary.totalLots) : 0}%`}
              sub={`${data.summary.outsold.toLocaleString()} lots`}
              color={STATUS_COLORS.outsold}
            />
            <StatCard
              label="Unsold"
              value={`${data.summary.totalLots ? Math.round((data.summary.unsold * 100) / data.summary.totalLots) : 0}%`}
              sub={`${data.summary.unsold.toLocaleString()} lots`}
              color={STATUS_COLORS.unsold}
            />
          </div>

          {/* ---- Flagship: Price & Classification — Sale x Broker ---- */}
          <div>
            <h3 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-0.5">Price &amp; Classification — Sale x Broker</h3>
            <p className="text-[11.5px] text-text-muted m-0 mb-2">
              Each cell: average achieved price, Select Best share of that broker&rsquo;s sold lots, and overall sold rate — for that one sale.
            </p>
            {pivot && (
              <Table>
                <thead>
                  <tr style={{ background: "var(--brand-olive-deep, #4E5715)" }}>
                    <th className={th}>Broker</th>
                    {data.sales.map((s) => (
                      <th key={s.label} className={th + " text-center"}>
                        {s.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {pivot.brokerOrder.map((broker, i) => (
                    <tr key={broker} style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)" }}>
                      <td className={td + " font-semibold text-text-strong"}>{broker}</td>
                      {data.sales.map((s) => {
                        const key = `${s.saleNo}/${s.saleYear}`;
                        const row = pivot.byBroker.get(broker)?.get(key);
                        if (!row || row.sold === 0) {
                          return (
                            <td key={key} className={td + " text-center text-text-muted"}>
                              —
                            </td>
                          );
                        }
                        return (
                          <td key={key} className={td + " text-center"}>
                            <div className="font-semibold" style={{ color: "var(--brand-gold-deep, #8F6C08)" }}>
                              Rs {row.avgPriceRsKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}/kg
                            </div>
                            <div className="text-[10.5px] text-text-muted">
                              {row.selectBestSharePct.toFixed(0)}% SB · {row.soldPct.toFixed(0)}% sold
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </div>

          {/* ---- Broker Distribution ---- */}
          <div>
            <h3 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-2">Broker Distribution</h3>
            <Table>
              <thead>
                <tr style={{ background: "var(--brand-olive-deep, #4E5715)" }}>
                  <th className={th}>Broker</th>
                  <th className={th + " text-right"}>Lots</th>
                  <th className={th + " text-right"}>Share</th>
                  <th className={th + " text-right"}>Marks</th>
                  <th className={th + " text-right"}>Qty sold (kg)</th>
                  <th className={th + " text-right"}>Avg. price</th>
                </tr>
              </thead>
              <tbody>
                {data.brokerDistribution.map((b, i) => (
                  <tr key={b.broker} style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)" }}>
                    <td className={td + " font-semibold text-text-strong"}>{b.broker}</td>
                    <td className={td + " text-right"}>{b.lots.toLocaleString()}</td>
                    <td className={td + " text-right"}>{b.sharePct.toFixed(1)}%</td>
                    <td className={td + " text-right"}>{b.distinctMarks}</td>
                    <td className={td + " text-right"}>{b.qtySoldKg.toLocaleString()}</td>
                    <td className={td + " text-right"}>Rs {b.avgPriceRsKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {/* ---- Sold / Outsold / Unsold ---- */}
          <div>
            <h3 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-2">Sold / Outsold / Unsold</h3>
            <Table>
              <thead>
                <tr style={{ background: "var(--brand-olive-deep, #4E5715)" }}>
                  <th className={th}>Broker</th>
                  <th className={th + " text-right"}>Sold %</th>
                  <th className={th + " text-right"}>Outsold %</th>
                  <th className={th + " text-right"}>Unsold %</th>
                  <th className={th + " text-right"}>Total</th>
                </tr>
              </thead>
              <tbody>
                {data.status.map((s, i) => (
                  <tr key={s.broker} style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)" }}>
                    <td className={td + " font-semibold text-text-strong"}>{s.broker}</td>
                    <td className={td + " text-right"} style={{ color: STATUS_COLORS.sold }}>{s.soldPct.toFixed(1)}%</td>
                    <td className={td + " text-right"} style={{ color: STATUS_COLORS.outsold }}>{s.outsoldPct.toFixed(1)}%</td>
                    <td className={td + " text-right"} style={{ color: STATUS_COLORS.unsold }}>{s.unsoldPct.toFixed(1)}%</td>
                    <td className={td + " text-right"}>{s.total.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>

          {/* ---- Price Tiers ---- */}
          <div>
            <h3 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-2">Price Tiers</h3>
            <Table>
              <thead>
                <tr style={{ background: "var(--brand-olive-deep, #4E5715)" }}>
                  <th className={th}>Tier</th>
                  <th className={th + " text-right"}>Lots</th>
                  <th className={th + " text-right"}>Share</th>
                  <th className={th + " text-right"}>Avg. price</th>
                  <th className={th + " text-right"}>Min</th>
                  <th className={th + " text-right"}>Max</th>
                </tr>
              </thead>
              <tbody>
                {TIER_NAMES.map((tier, i) => {
                  const row = data.tiers.find((t) => t.tier === tier);
                  if (!row) return null;
                  return (
                    <tr key={tier} style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)" }}>
                      <td className={td + " font-semibold text-text-strong"}>{tier}</td>
                      <td className={td + " text-right"}>{row.lots.toLocaleString()}</td>
                      <td className={td + " text-right"}>{row.sharePct.toFixed(1)}%</td>
                      <td className={td + " text-right"}>Rs {row.avgPriceRsKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className={td + " text-right"}>Rs {row.minPriceRsKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                      <td className={td + " text-right"}>Rs {row.maxPriceRsKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          </div>

          {/* ---- Sale Trend ---- */}
          <div>
            <h3 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-2">Sale Trend</h3>
            <Table>
              <thead>
                <tr style={{ background: "var(--brand-olive-deep, #4E5715)" }}>
                  <th className={th}>Sale</th>
                  <th className={th + " text-right"}>Lots</th>
                  <th className={th + " text-right"}>Sold %</th>
                  <th className={th + " text-right"}>Qty sold (kg)</th>
                  <th className={th + " text-right"}>Avg. price</th>
                </tr>
              </thead>
              <tbody>
                {data.trend.map((t, i) => (
                  <tr key={`${t.saleNo}/${t.saleYear}`} style={{ background: i % 2 === 0 ? "var(--surface)" : "var(--surface-alt)" }}>
                    <td className={td + " font-semibold text-text-strong"}>Sale {t.saleNo}/{t.saleYear}</td>
                    <td className={td + " text-right"}>{t.lotsOffered.toLocaleString()}</td>
                    <td className={td + " text-right"}>{t.soldPct.toFixed(1)}%</td>
                    <td className={td + " text-right"}>{t.qtySoldKg.toLocaleString()}</td>
                    <td className={td + " text-right"}>Rs {t.avgPriceRsKg.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </div>
        </div>
      )}

      <div className="border border-border rounded-[var(--radius-lg)] p-4" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">Generated workbooks</h3>
        {outputs === null ? (
          <div className="flex justify-center py-8">
            <TeaLoader size={36} />
          </div>
        ) : outputs.length === 0 ? (
          <p className="text-[12px] text-text-muted m-0">Nothing generated yet.</p>
        ) : (
          <div className="flex flex-col gap-1.5">
            {outputs.map((o) => (
              <div key={o.id} className="flex items-center gap-2 text-[13px] border-b border-border last:border-b-0 py-2">
                <span className="flex-1 min-w-0 truncate text-text-strong">{o.title}</span>
                <span className="font-mono text-[12px] text-text-muted shrink-0">{new Date(o.createdAt).toLocaleString()}</span>
                {o.downloadable ? (
                  <Tooltip title="Download">
                    <span>
                      <IconButton size="small" onClick={() => download(o)} disabled={downloadingId === o.id} aria-label={`Download ${o.title}`}>
                        {downloadingId === o.id ? <CircularProgress size={16} /> : <DownloadOutlinedIcon fontSize="small" />}
                      </IconButton>
                    </span>
                  </Tooltip>
                ) : (
                  <span className="text-[11px] text-text-muted italic shrink-0">{o.notes}</span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
