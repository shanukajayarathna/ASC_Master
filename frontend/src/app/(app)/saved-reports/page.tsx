"use client";

import { RichText } from "@/components/assistant/RichText";
import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api } from "@/lib/api";
import type { SavedReport } from "@/types/api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useEffect, useState } from "react";

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

const REPORT_LABELS: Record<string, string> = {
  executive: "Executive Summary",
  broker: "Broker Summary",
  grade: "Grade Summary",
  category: "Category Summary",
  garden: "Garden Summary",
  classification: "Classification Report",
  valuation: "Valuation Analysis",
};

export default function SavedReportsPage() {
  const [reports, setReports] = useState<SavedReport[]>([]);
  const [loading, setLoading] = useState(true);
  // Report whose delete is in flight — its button locks so a double-click can't fire twice.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // A custom report open in the viewer: the snapshot is fetched on demand, never with the list.
  const [viewing, setViewing] = useState<{ report: SavedReport; content: string | null; error: boolean } | null>(null);

  const refresh = () => {
    setLoading(true);
    api
      .listSavedReports()
      .then(setReports)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteSavedReport(id);
      setReports((r) => r.filter((x) => x.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const view = async (r: SavedReport) => {
    setViewing({ report: r, content: null, error: false });
    try {
      const { content } = await api.getSavedReportContent(r.id);
      setViewing((v) => (v && v.report.id === r.id ? { ...v, content } : v));
    } catch {
      setViewing((v) => (v && v.report.id === r.id ? { ...v, error: true } : v));
    }
  };

  const download = async (r: SavedReport) => {
    setDownloadingId(r.id);
    try {
      const { blob, fileName } = await api.downloadSavedReport(r.id);
      downloadBlob(blob, fileName ?? `${r.title}.zip`);
    } finally {
      setDownloadingId(null);
    }
  };

  return (
    <div>
      <PageHeader
        title="Saved Reports"
        subtitle="Reports you've bookmarked — reopening regenerates them against current data. Custom reports from the AI Assistant are saved as a snapshot of the figures at the time."
      />

      {loading ? (
        <div className="flex justify-center py-16">
          <TeaLoader size={44} />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-[var(--radius-lg)]">
          <p className="m-0">No saved reports yet — generate one from Reports and click Save.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border border-border rounded-[var(--radius-lg)] bg-surface px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-strong truncate">{REPORT_LABELS[r.type] ?? r.title}</div>
                <div className="text-[11px] text-text-muted font-mono">
                  {r.notes ?? r.source ?? "—"} · {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              {r.hasContent ? (
                <Tooltip title="View">
                  <IconButton size="small" onClick={() => view(r)} aria-label={`View ${r.title}`}>
                    <VisibilityOutlinedIcon fontSize="small" />
                  </IconButton>
                </Tooltip>
              ) : r.downloadable ? (
                <Tooltip title="Download">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => download(r)}
                      disabled={downloadingId === r.id}
                      aria-busy={downloadingId === r.id}
                      aria-label={`Download ${r.title}`}
                    >
                      {downloadingId === r.id ? <CircularProgress size={16} /> : <DownloadOutlinedIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              ) : (
                r.catalogueId && (
                  <Tooltip title="Reopen">
                    <IconButton
                      size="small"
                      component={Link}
                      href={`/reports/summary?type=${r.type}&catalogueId=${r.catalogueId}`}
                      aria-label={`Reopen ${r.title}`}
                    >
                      <OpenInNewOutlinedIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                )
              )}
              <Tooltip title="Delete">
                <span>
                  <IconButton
                    size="small"
                    onClick={() => remove(r.id)}
                    disabled={deletingId === r.id}
                    aria-busy={deletingId === r.id}
                    aria-label={`Delete ${r.title}`}
                  >
                    {deletingId === r.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon fontSize="small" />}
                  </IconButton>
                </span>
              </Tooltip>
            </div>
          ))}
        </div>
      )}

      <Dialog open={viewing !== null} onClose={() => setViewing(null)} maxWidth="md" fullWidth>
        <DialogTitle>{viewing?.report.title}</DialogTitle>
        <DialogContent dividers>
          {viewing?.error ? (
            <p className="m-0 text-danger text-[13px]">Couldn&apos;t load this report.</p>
          ) : viewing?.content === null ? (
            <div className="flex justify-center py-8">
              <TeaLoader size={36} />
            </div>
          ) : viewing ? (
            <div className="text-[14px] leading-relaxed whitespace-pre-wrap break-words">
              <RichText text={viewing.content ?? ""} />
            </div>
          ) : null}
          {viewing && !viewing.error && (
            <p className="mt-3 mb-0 text-[11.5px] text-text-muted">
              Snapshot saved {new Date(viewing.report.createdAt).toLocaleString()} — figures don&apos;t change if the data is updated later.
            </p>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setViewing(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </div>
  );
}
