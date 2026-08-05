"use client";

import { api } from "@/lib/api";
import type { SavedReport } from "@/types/api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useEffect, useState } from "react";

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
    await api.deleteSavedReport(id);
    setReports((r) => r.filter((x) => x.id !== id));
  };

  return (
    <div>
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-text-strong m-0 mb-1">Saved Reports</h1>
        <p className="text-[13px] text-text-muted m-0">Reports you&apos;ve bookmarked — reopening regenerates them against current data.</p>
      </div>

      {loading ? (
        <div className="flex justify-center py-16">
          <CircularProgress size={22} sx={{ color: "var(--liquor)" }} />
        </div>
      ) : reports.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <p className="m-0">No saved reports yet — generate one from Reports and click Save.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {reports.map((r) => (
            <div key={r.id} className="flex items-center gap-3 border border-border rounded-lg bg-surface px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-strong truncate">{REPORT_LABELS[r.type] ?? r.title}</div>
                <div className="text-[11px] text-text-muted font-mono">
                  {r.source ?? "—"} · {new Date(r.createdAt).toLocaleString()}
                </div>
              </div>
              <Tooltip title="Reopen">
                <IconButton
                  size="small"
                  component={Link}
                  href={`/reports?type=${r.type}${r.catalogueId ? `&catalogueId=${r.catalogueId}` : ""}`}
                  aria-label={`Reopen ${r.title}`}
                >
                  <OpenInNewOutlinedIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={() => remove(r.id)} aria-label={`Delete ${r.title}`}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
