"use client";

import { api } from "@/lib/api";
import type { ExportColumn } from "@/lib/exportColumns";
import { printLotsReport } from "@/lib/printReport";
import type { Lot } from "@/types/api";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Checkbox from "@mui/material/Checkbox";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import ViewColumnIcon from "@mui/icons-material/ViewColumn";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { useState } from "react";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "catalogue";
}

/**
 * Export / share for a set of lots. The set may span several sales, so each lot is turned
 * into a (catalogue, lot) ref via `catalogueIdForLot`. The Excel path opens a column picker
 * seeded from `defaultColumnIds` (the grid's shown columns) so a download carries only the
 * ticked columns; PDF and Share use those same default columns.
 */
export default function ExportShareMenu({
  lots,
  reportTitle,
  catalogueIdForLot,
  availableColumns,
  defaultColumnIds,
  dark,
}: {
  lots: Lot[];
  reportTitle: string;
  catalogueIdForLot: (lot: Lot) => string;
  availableColumns: ExportColumn[];
  defaultColumnIds: string[];
  dark?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState<"excel" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Column picker (Excel). Opened seeded from the shown columns; edits live only while open.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [picked, setPicked] = useState<Set<string>>(new Set(defaultColumnIds));

  const disabled = lots.length === 0;
  const fileBase = sanitizeFileName(reportTitle);

  const lotRefs = () => lots.map((l) => ({ catalogueId: catalogueIdForLot(l), lotId: l.id }));
  const columnsFrom = (ids: Set<string>) =>
    availableColumns.filter((c) => ids.has(c.id)).map((c) => ({ kind: c.kind, key: c.key, label: c.label }));

  const triggerDownload = (blob: Blob, name: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const openPicker = () => {
    setPicked(new Set(defaultColumnIds));
    setAnchor(null);
    setPickerOpen(true);
  };

  const togglePicked = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const downloadExcel = async () => {
    setBusy("excel");
    setError(null);
    try {
      const blob = await api.exportExcel(lotRefs(), columnsFrom(picked));
      triggerDownload(blob, `${fileBase}_lot_report.xlsx`);
      setPickerOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Excel export failed");
    } finally {
      setBusy(null);
    }
  };

  const handlePdf = () => {
    setError(null);
    printLotsReport(lots, reportTitle);
    setAnchor(null);
  };

  const handleShare = async () => {
    setBusy("share");
    setError(null);
    try {
      // Share carries the same default (shown) columns as the quick export.
      const blob = await api.exportExcel(lotRefs(), columnsFrom(new Set(defaultColumnIds)));
      const file = new File([blob], `${fileBase}_lot_report.xlsx`, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const shareData = {
        files: [file],
        title: `${reportTitle} — Lot Report`,
        text: `Tea auction lot report for ${reportTitle} (${lots.length} lot${lots.length === 1 ? "" : "s"}).`,
      };
      if (navigator.canShare?.(shareData) && navigator.share) {
        await navigator.share(shareData);
      } else {
        // Web Share API with files isn't supported here (desktop browsers, mostly) — fall back to
        // downloading the file and opening a WhatsApp chat so the user can attach it manually.
        triggerDownload(blob, file.name);
        window.open(
          `https://wa.me/?text=${encodeURIComponent(
            `${shareData.text} The report file has just been downloaded — attach it from your Downloads folder.`
          )}`,
          "_blank",
          "noopener,noreferrer"
        );
      }
    } catch (e) {
      if (e instanceof DOMException && e.name === "AbortError") {
        // user cancelled the native share sheet — not an error
      } else {
        setError(e instanceof Error ? e.message : "Share failed");
      }
    } finally {
      setBusy(null);
      setAnchor(null);
    }
  };

  return (
    <>
      <Button
        variant="outlined"
        size="small"
        disabled={disabled}
        startIcon={<FileDownloadOutlinedIcon fontSize="small" />}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={dark ? { color: "#fff", borderColor: "rgba(255,255,255,0.3)" } : undefined}
      >
        Export
      </Button>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        <MenuItem onClick={openPicker}>
          <ListItemIcon>
            <ViewColumnIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Export as Excel — choose columns…" secondary={`${lots.length.toLocaleString()} lot(s)`} />
        </MenuItem>
        <MenuItem onClick={handlePdf}>
          <ListItemIcon>
            <PictureAsPdfOutlinedIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText primary="Export as PDF" secondary="Opens print dialog — choose Save as PDF" />
        </MenuItem>
        <MenuItem onClick={handleShare} disabled={busy !== null}>
          <ListItemIcon>
            {busy === "share" ? (
              <CircularProgress size={16} />
            ) : typeof navigator !== "undefined" && "share" in navigator ? (
              <ShareOutlinedIcon fontSize="small" />
            ) : (
              <WhatsAppIcon fontSize="small" />
            )}
          </ListItemIcon>
          <ListItemText primary="Share…" secondary="WhatsApp, email, or any app on this device" />
        </MenuItem>
      </Menu>

      <Dialog open={pickerOpen} onClose={() => (busy ? null : setPickerOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Columns for Excel</DialogTitle>
        <DialogContent>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[12px] text-text-muted">
              {picked.size} of {availableColumns.length} columns
            </span>
            <div className="ml-auto flex gap-1">
              <Button size="small" onClick={() => setPicked(new Set(availableColumns.map((c) => c.id)))}>
                All
              </Button>
              <Button size="small" onClick={() => setPicked(new Set(defaultColumnIds))}>
                Shown
              </Button>
              <Button size="small" onClick={() => setPicked(new Set())}>
                None
              </Button>
            </div>
          </div>
          <div className="max-h-[46vh] overflow-y-auto -mx-1">
            {availableColumns.map((c) => (
              <label
                key={c.id}
                className="flex items-center gap-1.5 px-1 py-0.5 rounded cursor-pointer hover:bg-surface-sunken text-[13px]"
              >
                <Checkbox size="small" sx={{ p: 0.5 }} checked={picked.has(c.id)} onChange={() => togglePicked(c.id)} />
                <span className="truncate">{c.label}</span>
                {c.kind === "field" && (
                  <span className="ml-auto text-[10px] uppercase tracking-wide text-text-muted font-mono">app</span>
                )}
              </label>
            ))}
          </div>
          {error && <p className="text-[11.5px] text-danger mt-1">{error}</p>}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPickerOpen(false)} disabled={busy === "excel"}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={downloadExcel}
            disabled={busy === "excel" || picked.size === 0}
            startIcon={busy === "excel" ? <CircularProgress size={15} /> : <FileDownloadOutlinedIcon fontSize="small" />}
          >
            Download {picked.size} column{picked.size === 1 ? "" : "s"}
          </Button>
        </DialogActions>
      </Dialog>

      {error && !pickerOpen && (
        <p className="absolute mt-1 text-[11px] text-danger" style={{ maxWidth: 240 }}>
          {error}
        </p>
      )}
    </>
  );
}
