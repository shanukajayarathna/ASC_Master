"use client";

import { api } from "@/lib/api";
import { printLotsReport } from "@/lib/printReport";
import type { Lot } from "@/types/api";
import Button from "@mui/material/Button";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import CircularProgress from "@mui/material/CircularProgress";
import FileDownloadOutlinedIcon from "@mui/icons-material/FileDownloadOutlined";
import PictureAsPdfOutlinedIcon from "@mui/icons-material/PictureAsPdfOutlined";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import WhatsAppIcon from "@mui/icons-material/WhatsApp";
import { useState } from "react";

function sanitizeFileName(name: string): string {
  return name.replace(/[^a-z0-9]+/gi, "_").replace(/^_+|_+$/g, "") || "catalogue";
}

export default function ExportShareMenu({
  catalogueId,
  catalogueName,
  lots,
  dark,
}: {
  catalogueId: string;
  catalogueName: string;
  lots: Lot[];
  dark?: boolean;
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState<"excel" | "pdf" | "share" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const disabled = lots.length === 0;
  const fileBase = sanitizeFileName(catalogueName);

  const downloadExcelBlob = async (): Promise<Blob> => api.exportExcel(catalogueId, lots.map((l) => l.id));

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

  const handleExcel = async () => {
    setBusy("excel");
    setError(null);
    try {
      const blob = await downloadExcelBlob();
      triggerDownload(blob, `${fileBase}_lot_report.xlsx`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Excel export failed");
    } finally {
      setBusy(null);
      setAnchor(null);
    }
  };

  const handlePdf = () => {
    setError(null);
    printLotsReport(lots, catalogueName);
    setAnchor(null);
  };

  const handleShare = async () => {
    setBusy("share");
    setError(null);
    try {
      const blob = await downloadExcelBlob();
      const file = new File([blob], `${fileBase}_lot_report.xlsx`, {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const shareData = {
        files: [file],
        title: `${catalogueName} — Lot Report`,
        text: `Tea auction lot report for ${catalogueName} (${lots.length} lot${lots.length === 1 ? "" : "s"}).`,
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
        <MenuItem onClick={handleExcel} disabled={busy !== null}>
          <ListItemIcon>
            {busy === "excel" ? <CircularProgress size={16} /> : <FileDownloadOutlinedIcon fontSize="small" />}
          </ListItemIcon>
          <ListItemText primary="Export as Excel" secondary={`${lots.length.toLocaleString()} lot(s)`} />
        </MenuItem>
        <MenuItem onClick={handlePdf} disabled={busy !== null}>
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
      {error && (
        <p className="absolute mt-1 text-[11px] text-danger" style={{ maxWidth: 240 }}>
          {error}
        </p>
      )}
    </>
  );
}
