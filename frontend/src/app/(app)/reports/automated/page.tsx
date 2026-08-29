"use client";

import PageHeader from "@/components/shared/PageHeader";
import SendReportEmailButton from "@/components/shared/SendReportEmailButton";
import TeaLoader from "@/components/shared/TeaLoader";
import { api, ApiError } from "@/lib/api";
import type { ScheduledReportJob, ScheduledReportOutput, StagedCbac } from "@/types/api";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import ExpandMoreOutlinedIcon from "@mui/icons-material/ExpandMoreOutlined";
import PlayArrowOutlinedIcon from "@mui/icons-material/PlayArrowOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

const JOB_STATUS_COLOR: Record<string, string> = {
  Succeeded: "var(--sage-dark)",
  Waiting: "var(--warn)",
  Failed: "var(--danger)",
  NeverRun: "var(--text-muted)",
};

function formatDuration(ms: number): string {
  if (ms <= 0) return "—";
  return ms < 1000 ? `${ms}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** One registered job's row — trigger/status/last-run at a glance, Run Now for a manual
 *  override, and an on-demand expand for what it's actually produced (see
 *  ScheduledReportJobsController's own doc comment: run history itself lives in the Audit
 *  Log, filtered to this job's Key, not duplicated here). Enable/disable and Run Now are
 *  available to any signed-in user — these jobs only ever touch their own generated reports,
 *  never the underlying sale data, so there's nothing here that needs Admin-only gating. */
function JobRow({ job, onChanged }: { job: ScheduledReportJob; onChanged: () => void }) {
  const [running, setRunning] = useState(false);
  const [runMessage, setRunMessage] = useState<string | null>(null);
  const [outputsOpen, setOutputsOpen] = useState(false);
  const [outputs, setOutputs] = useState<ScheduledReportOutput[] | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const toggle = async () => {
    try {
      await api.toggleScheduledReportJob(job.key, !job.enabled);
      onChanged();
    } catch {
      // Best-effort — the checkbox just stays as it was; onChanged() re-syncs from the server either way.
    }
  };

  const runNow = async () => {
    setRunning(true);
    setRunMessage(null);
    try {
      const result = await api.runScheduledReportJobNow(job.key);
      setRunMessage(result.message);
      onChanged();
      if (outputsOpen) loadOutputs();
    } catch (e) {
      setRunMessage(e instanceof ApiError ? e.message : "Run failed");
    } finally {
      setRunning(false);
    }
  };

  const loadOutputs = () => {
    api.listScheduledReportOutputs(job.key).then(setOutputs).catch(() => setOutputs([]));
  };

  const toggleOutputs = () => {
    const next = !outputsOpen;
    setOutputsOpen(next);
    if (next && outputs === null) loadOutputs();
  };

  const download = async (o: ScheduledReportOutput) => {
    setDownloadingId(o.id);
    try {
      const { blob, fileName } = await api.downloadSavedReport(o.id);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName ?? `${o.title}.zip`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <>
      <tr className="border-b border-border align-top">
        <td className="px-2 py-2.5">
          <div className="font-medium text-text-strong">{job.displayName}</div>
          <div className="font-mono text-[12px] text-text-muted">{job.key}</div>
        </td>
        <td className="px-2 py-2.5 font-mono text-[12px] text-text-muted">
          {job.triggerType === "AfterSaleClose" ? "After sale close" : job.cronExpression}
        </td>
        <td className="px-2 py-2.5 text-text-muted">
          {job.lastRunAt ? new Date(job.lastRunAt).toLocaleString() : "Never"}
          {job.lastRunAt && <span className="font-mono text-[12px] ml-1.5">({formatDuration(job.lastDurationMs)})</span>}
        </td>
        <td className="px-2 py-2.5">
          <span className="font-medium" style={{ color: JOB_STATUS_COLOR[job.lastStatus] }}>
            {job.lastStatus}
          </span>
          {job.consecutiveFailures >= 3 && (
            <span className="ml-1.5 text-[12px] font-mono" style={{ color: "var(--danger)" }}>
              ({job.consecutiveFailures}× in a row)
            </span>
          )}
          {job.lastMessage && <div className="text-[11px] text-text-muted mt-0.5 max-w-md">{job.lastMessage}</div>}
        </td>
        <td className="px-2 py-2.5">
          <Tooltip title={job.enabled ? "Enabled — click to disable" : "Disabled — click to enable"}>
            <Switch size="small" checked={job.enabled} onChange={toggle} />
          </Tooltip>
        </td>
        <td className="px-2 py-2.5 whitespace-nowrap">
          <Tooltip title="Run now">
            <span>
              <IconButton size="small" onClick={runNow} disabled={running} aria-label={`Run ${job.displayName} now`}>
                {running ? <CircularProgress size={16} /> : <PlayArrowOutlinedIcon fontSize="small" />}
              </IconButton>
            </span>
          </Tooltip>
          <Tooltip title="Outputs">
            <IconButton size="small" onClick={toggleOutputs} aria-label={`Show ${job.displayName} outputs`}>
              <ExpandMoreOutlinedIcon fontSize="small" sx={{ transform: outputsOpen ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }} />
            </IconButton>
          </Tooltip>
        </td>
      </tr>
      {runMessage && (
        <tr className="border-b border-border">
          <td colSpan={6} className="px-2 py-1.5 text-[12px]" style={{ background: "var(--surface-sunken)" }}>
            {runMessage}
          </td>
        </tr>
      )}
      {outputsOpen && (
        <tr className="border-b border-border">
          <td colSpan={6} className="px-2 py-2.5" style={{ background: "var(--surface-sunken)" }}>
            {outputs === null ? (
              <span className="text-[12px] text-text-muted">Loading…</span>
            ) : outputs.length === 0 ? (
              <span className="text-[12px] text-text-muted">Nothing generated yet.</span>
            ) : (
              <div className="flex flex-col gap-1.5">
                {outputs.map((o) => (
                  <div key={o.id} className="flex items-center gap-2 text-[12px]">
                    <span className="flex-1 min-w-0 truncate text-text-strong">{o.title}</span>
                    <span className="font-mono text-[12px] text-text-muted shrink-0">{new Date(o.createdAt).toLocaleDateString()}</span>
                    {o.downloadable ? (
                      <>
                        <IconButton size="small" onClick={() => download(o)} disabled={downloadingId === o.id} aria-label={`Download ${o.title}`}>
                          {downloadingId === o.id ? <CircularProgress size={14} /> : <DownloadOutlinedIcon sx={{ fontSize: 15 }} />}
                        </IconButton>
                        <SendReportEmailButton reportId={o.id} reportTitle={o.title} />
                      </>
                    ) : (
                      <span className="text-[11px] text-text-muted italic shrink-0">{o.notes}</span>
                    )}
                  </div>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/** Staging area for Weekly FACT's CBAC elevation-average TXT — the one input that can't be
 *  derived from the database (see IWeeklyFactCbacStagingStore's doc comment). Stage it
 *  whenever it arrives during the week; WeeklyFactAutoReportJob picks it up on its own once
 *  the matching sale has also closed. */
function CbacStagingPanel() {
  const [staged, setStaged] = useState<StagedCbac[] | null>(null);
  const [saleYear, setSaleYear] = useState(new Date().getFullYear());
  const [saleNo, setSaleNo] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [txtContent, setTxtContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    api.listStagedCbac().then(setStaged).catch(() => setStaged([]));
  };
  useEffect(() => {
    refresh();
  }, []);

  const onFile = async (f: File) => {
    setFileName(f.name);
    setTxtContent(await f.text());
  };

  const stage = async () => {
    const saleNoNum = parseInt(saleNo, 10);
    if (!saleNoNum || !txtContent.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.stageCbac(saleYear, saleNoNum, txtContent);
      setSaleNo("");
      setTxtContent("");
      setFileName(null);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't stage this file");
    } finally {
      setSaving(false);
    }
  };

  const remove = async (year: number, sale: number) => {
    await api.deleteStagedCbac(year, sale);
    refresh();
  };

  return (
    <div className="mt-5 pt-4 border-t border-border">
      <h3 className="font-display text-[14px] font-semibold text-text-strong m-0 mb-1">CBAC Benchmark Staging</h3>
      <p className="text-[12px] text-text-muted m-0 mb-3">
        Weekly FACT can build the factory-wise (WES) side from the MSL archive automatically, but the CBAC elevation-average
        TXT has no database equivalent — stage it here whenever it arrives, independent of when the sale closes.
      </p>

      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

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
        <Button size="small" variant="outlined" component="label" startIcon={<CloudUploadOutlinedIcon fontSize="small" />}>
          {fileName ?? "Choose CBAC TXT"}
          <input
            ref={fileInputRef}
            type="file"
            accept=".txt"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onFile(f);
            }}
          />
        </Button>
        <Button size="small" variant="contained" onClick={stage} disabled={saving || !saleNo || !txtContent.trim()}>
          {saving ? "Staging…" : "Stage"}
        </Button>
      </div>

      {staged === null ? (
        <span className="text-[12px] text-text-muted">Loading…</span>
      ) : staged.length === 0 ? (
        <p className="text-[12px] text-text-muted m-0">Nothing staged right now.</p>
      ) : (
        <div className="flex flex-wrap gap-2">
          {staged.map((s) => (
            <span
              key={`${s.saleYear}-${s.saleNo}`}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border text-[12px] font-mono"
              style={{ background: "var(--surface)" }}
            >
              Sale {s.saleNo}/{s.saleYear}
              <IconButton size="small" onClick={() => remove(s.saleYear, s.saleNo)} sx={{ p: 0.25 }} aria-label={`Remove staged CBAC for sale ${s.saleNo}/${s.saleYear}`}>
                <DeleteOutlineIcon sx={{ fontSize: 13 }} />
              </IconButton>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function AutomatedReportsPage() {
  const [jobs, setJobs] = useState<ScheduledReportJob[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api.listScheduledReportJobs().then(setJobs).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load automated reports"));
  };
  useEffect(() => {
    refresh();
  }, []);

  return (
    <div>
      <PageHeader
        title="Automated Reports"
        subtitle="Reports that generate themselves on schedule or on trigger, with no one needing to click Generate."
        backTo={{ href: "/reports", label: "Reports" }}
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      <div className="border border-border rounded-[var(--radius-lg)] p-4" style={{ background: "var(--surface)" }}>
        {jobs === null ? (
          <div className="flex justify-center py-8">
            <TeaLoader size={40} />
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {(["Weekly", "Monthly"] as const).map((cadence) => {
              const group = jobs.filter((j) => j.cadence === cadence);
              if (group.length === 0) return null;
              return (
                <div key={cadence} className="overflow-x-auto">
                  <h4 className="font-display text-[13px] font-semibold text-text-strong m-0 mb-1.5">{cadence} Reports</h4>
                  <table className="w-full text-[13px]">
                    <thead>
                      <tr className="border-b border-border">
                        <th className="text-left px-2 py-2 font-medium text-text-muted">Job</th>
                        <th className="text-left px-2 py-2 font-medium text-text-muted">Trigger</th>
                        <th className="text-left px-2 py-2 font-medium text-text-muted">Last Run</th>
                        <th className="text-left px-2 py-2 font-medium text-text-muted">Status</th>
                        <th className="text-left px-2 py-2 font-medium text-text-muted">Enabled</th>
                        <th className="text-left px-2 py-2 font-medium text-text-muted">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {group.map((j) => (
                        <JobRow key={j.key} job={j} onChanged={refresh} />
                      ))}
                    </tbody>
                  </table>
                </div>
              );
            })}
          </div>
        )}

        <CbacStagingPanel />
      </div>
    </div>
  );
}
