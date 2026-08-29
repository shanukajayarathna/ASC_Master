"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api, ApiError } from "@/lib/api";
import type { ScheduledReportOutput } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useState } from "react";

export default function FactorySaleSummaryPage() {
  const [saleYear, setSaleYear] = useState(new Date().getFullYear());
  const [saleNo, setSaleNo] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [outputs, setOutputs] = useState<ScheduledReportOutput[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const refresh = () => {
    api.listFactorySaleSummaryOutputs().then(setOutputs).catch(() => setOutputs([]));
  };
  useEffect(() => {
    refresh();
  }, []);

  const generate = async () => {
    const saleNoNum = parseInt(saleNo, 10);
    if (!saleYear || !saleNoNum) return;
    setGenerating(true);
    setError(null);
    try {
      await api.generateFactorySaleSummary(saleYear, saleNoNum);
      refresh();
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

  return (
    <div>
      <PageHeader
        title="Factory Sale Summary"
        subtitle="Estate-wise and Owner/Plantation-group-wise QTY, AVG and unsold breakdown across every broker in a sale, plus a TOTAL column."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-1">Generate for a sale</h3>
        <p className="text-[12px] text-text-muted m-0 mb-3">
          This also generates itself automatically once a sale closes — use this to build it right now instead of waiting,
          or to rebuild it after new lots land.
        </p>
        <div className="flex items-end gap-2 flex-wrap">
          <TextField
            label="Sale Year"
            type="number"
            size="small"
            value={saleYear}
            onChange={(e) => setSaleYear(parseInt(e.target.value, 10) || saleYear)}
            sx={{ width: 110 }}
          />
          <TextField label="Sale No" size="small" value={saleNo} onChange={(e) => setSaleNo(e.target.value)} sx={{ width: 90 }} />
          <Button
            size="small"
            variant="contained"
            startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlinedIcon fontSize="small" />}
            onClick={generate}
            disabled={generating || !saleNo.trim()}
          >
            {generating ? "Generating…" : "Generate report"}
          </Button>
        </div>
      </div>

      <div className="border border-border rounded-[var(--radius-lg)] p-4" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-3">Generated reports</h3>
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
