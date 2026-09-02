"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api } from "@/lib/api";
import type { ScheduledReportOutput } from "@/types/api";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

// Matches BrokerCode.All on the backend (Modules/MarkIntelligence/BrokerCatalogueUploadParser.cs)
// exactly — order, codes, and which code each broker's raw file identifies as (not always what
// the file itself or its own filename says — MB's own file says "MB", but the canonical code
// everywhere else in this app is "MPB"; AEB's file says "EB").
const BROKER_SLOTS: { code: string; label: string }[] = [
  { code: "ASC", label: "ASC (your own catalogue)" },
  { code: "EB", label: "AEB" },
  { code: "BC", label: "BC" },
  { code: "JK", label: "JK" },
  { code: "LC", label: "LCBL" },
  { code: "MPB", label: "MB / MPB" },
  { code: "FW", label: "FW" },
  { code: "CT", label: "CTB" },
];

export default function SharedMarkCatalogueSummaryPage() {
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [saleYear, setSaleYear] = useState(new Date().getFullYear());
  const [saleNo, setSaleNo] = useState("");
  const [saleDate, setSaleDate] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [outputs, setOutputs] = useState<ScheduledReportOutput[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  const refresh = () => {
    api.listSharedMarkCatalogueSummaryOutputs().then(setOutputs).catch(() => setOutputs([]));
  };
  useEffect(() => {
    refresh();
  }, []);

  const allFilesChosen = BROKER_SLOTS.every((s) => files[s.code]);

  const generateFromUpload = async () => {
    const saleNoNum = parseInt(saleNo, 10);
    if (!saleYear || !saleNoNum || !saleDate || !allFilesChosen) return;
    setGenerating(true);
    setError(null);
    try {
      await api.generateSharedMarkCatalogueSummaryFromUpload(
        files as Record<string, File>,
        saleYear,
        saleNoNum,
        saleDate,
      );
      setFiles({});
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't generate this report from the uploaded files");
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
        title="Sharing Mark Catalogued Summary"
        subtitle="Every estate ASC shares with another Colombo broker — catalogued Sale/MTD/YTD quantity per side, split Low Grown vs High & Medium Grown."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      <div className="border border-border rounded-[var(--radius-lg)] p-4 mb-5" style={{ background: "var(--surface)" }}>
        <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-1">Generate from broker files</h3>
        <p className="text-[12px] text-text-muted m-0 mb-3">
          This report can&apos;t wait for a sale to close — these are pre-sale catalogues, shared by every broker before the
          auction happens. Upload all 8 to generate it now. All 8 are required: the report needs both ASC&apos;s own figures
          and every other broker&apos;s to know which estates are actually shared.
        </p>

        <div className="flex items-end gap-2 flex-wrap mb-3">
          <TextField
            label="Sale Year"
            type="number"
            size="small"
            value={saleYear}
            onChange={(e) => setSaleYear(parseInt(e.target.value, 10) || saleYear)}
            sx={{ width: 110 }}
          />
          <TextField label="Sale No" size="small" value={saleNo} onChange={(e) => setSaleNo(e.target.value)} sx={{ width: 90 }} />
          <TextField
            label="Sale Date"
            type="date"
            size="small"
            value={saleDate}
            onChange={(e) => setSaleDate(e.target.value)}
            slotProps={{ inputLabel: { shrink: true } }}
            sx={{ width: 160 }}
          />
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
          {BROKER_SLOTS.map((slot) => {
            const chosen = files[slot.code];
            return (
              <div key={slot.code}>
                <input
                  ref={(el) => {
                    fileInputRefs.current[slot.code] = el;
                  }}
                  type="file"
                  accept=".xls,.xlsx"
                  hidden
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    setFiles((prev) => ({ ...prev, [slot.code]: f }));
                  }}
                />
                <Button
                  fullWidth
                  size="small"
                  variant={chosen ? "outlined" : "text"}
                  color={chosen ? "success" : "inherit"}
                  startIcon={chosen ? <CheckCircleOutlinedIcon fontSize="small" /> : <UploadFileOutlinedIcon fontSize="small" />}
                  onClick={() => fileInputRefs.current[slot.code]?.click()}
                  sx={{ justifyContent: "flex-start", textTransform: "none" }}
                  title={chosen?.name}
                >
                  <span className="truncate">{chosen ? slot.label : slot.label}</span>
                </Button>
              </div>
            );
          })}
        </div>

        <Button
          size="small"
          variant="contained"
          startIcon={generating ? <CircularProgress size={14} color="inherit" /> : <PlayArrowOutlinedIcon fontSize="small" />}
          onClick={generateFromUpload}
          disabled={generating || !allFilesChosen || !saleNo.trim() || !saleDate}
        >
          {generating ? "Generating…" : "Generate report"}
        </Button>
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
