"use client";

import { api } from "@/lib/api";
import { useEffect, useState } from "react";
import { Fragment } from "react";
import ChartBlock, { parseChartSpec, type ChartSpec } from "./ChartBlock";
import CloseIcon from "@mui/icons-material/Close";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import DownloadOutlinedIcon from "@mui/icons-material/DownloadOutlined";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";

/** Structured clarifying question parsed from a CLARIFY: line (Claude-style options) —
 *  shared parsing so both AnalyticsChat and the main /assistant page recognize it the
 *  same way, since AnalyticsAgent (now reachable from both) emits this format. */
export function parseClarify(reply: string): { text: string; clarify?: { question: string; options: string[] } } {
  const m = reply.match(/^\s*CLARIFY:\s*(\{.*\})\s*$/m);
  if (!m) return { text: reply };
  try {
    const parsed = JSON.parse(m[1]);
    if (typeof parsed.question === "string" && Array.isArray(parsed.options) && parsed.options.length >= 2) {
      return {
        text: reply.replace(m[0], "").trimEnd(),
        clarify: { question: parsed.question, options: parsed.options.slice(0, 10).map(String) },
      };
    }
  } catch {
    // fall through: show raw text
  }
  return { text: reply };
}

/** Only same-origin relative paths and http(s) URLs render as real links — a `javascript:`,
 *  `data:`, or other exotic scheme renders as inert plain text instead. Link targets can be
 *  influenced by tool output the app's own agent prompts already label untrusted (e.g. text
 *  extracted from an uploaded document via search_knowledge_base), so this is a real
 *  boundary, not just tidiness: without it, a booby-trapped document could get a model to
 *  emit a markdown link whose href is a script URI, which React does not sanitize on its own. */
function isSafeUrl(url: string): boolean {
  if (url.startsWith("/") && !url.startsWith("//")) return true;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** A table the agent rendered — with a "Download as" bar so ANY tabular answer,
 *  however custom, is exportable exactly as shown (Excel via the server, CSV locally). */
export function ChatTable({ rows }: { rows: string[][] }) {
  const [busy, setBusy] = useState(false);
  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[T:]/g, "-");
  const headers = rows[0] ?? [];
  const body = rows.slice(1);

  const asExcel = async () => {
    setBusy(true);
    try {
      await api.downloadTableAsExcel(headers, body, `asc-chat-${stamp()}.xlsx`);
    } catch {
      /* surfaced by the button returning to idle; retry is the recovery */
    } finally {
      setBusy(false);
    }
  };
  const asCsv = () => {
    const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `asc-chat-${stamp()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="my-1.5 not-prose border border-border/60 rounded-md overflow-hidden">
      <div className="overflow-x-auto">
        <table className="text-[11.5px] border-collapse w-full">
          <tbody>
            {rows.map((r, ri) => (
              <tr key={ri} className={ri === 0 ? "bg-surface-sunken/60 font-semibold" : "border-t border-border/50"}>
                {r.map((c, ci) => (
                  <td key={ci} className={`px-2 py-1 whitespace-nowrap ${ci > 0 ? "text-right tabular-nums" : ""}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex items-center gap-2 px-2 py-1 border-t border-border/60 bg-surface-sunken/30 print:hidden">
        <span className="text-[10.5px] text-text-muted">Download as</span>
        <button onClick={asExcel} disabled={busy}
          className="px-2 py-0.5 rounded border border-brass/60 text-[11px] font-semibold text-text-strong hover:bg-brass/10 disabled:opacity-50">
          {busy ? "Preparing…" : "Excel"}
        </button>
        <button onClick={asCsv}
          className="px-2 py-0.5 rounded border border-border text-[11px] font-semibold text-text hover:bg-surface-sunken/60">
          CSV
        </button>
      </div>
    </div>
  );
}

/** Badge/color/kind-label per export format — agents generate Excel, PDF and PowerPoint
 *  files, so the card can't hard-code "XLSX"/"Excel workbook". */
const EXPORT_KINDS: Record<string, { badge: string; color: string; kind: string }> = {
  xlsx: { badge: "XLSX", color: "#1E6E45", kind: "Excel workbook" },
  pdf: { badge: "PDF", color: "#B3261E", kind: "PDF report" },
  pptx: { badge: "PPTX", color: "#C6410A", kind: "PowerPoint deck" },
  csv: { badge: "CSV", color: "#1E6E45", kind: "CSV file" },
};

/** Attachment-style card for agent-generated files — clear name, type, and one
 *  unmistakable Download action with busy/done/error states. */
function ExportFileCard({ url, filename }: { url: string; filename: string }) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [preview, setPreview] = useState<{ type: "pdf"; url: string } | { type: "xlsx"; sheet: string; rows: string[][] } | null>(null);
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  const info = EXPORT_KINDS[ext] ?? { badge: ext ? ext.toUpperCase().slice(0, 4) : "FILE", color: "#5B7A57", kind: "File" };
  const path = url.startsWith("http") ? new URL(url).pathname : url;
  useEffect(() => () => { if (preview?.type === "pdf") URL.revokeObjectURL(preview.url); }, [preview]);
  const download = async () => {
    setState("busy");
    try {
      await api.downloadAuthedFile(path, filename);
      setState("done");
    } catch {
      setState("error");
    }
  };
  const openFile = async () => {
    if (ext === "pptx" || !["pdf", "xlsx"].includes(ext)) { await download(); return; }
    setState("busy");
    try {
      const blob = await api.fetchAuthedFile(path);
      if (ext === "pdf") setPreview({ type: "pdf", url: URL.createObjectURL(blob) });
      else {
        const ExcelJS = (await import("exceljs")).default;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await blob.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("This workbook has no sheets.");
        const rows: string[][] = [];
        const displayCell = (value: unknown): string => {
          if (value == null) return "";
          if (value instanceof Date) return value.toLocaleDateString();
          if (typeof value === "object") {
            const record = value as Record<string, unknown>;
            if (typeof record.text === "string") return record.text;
            if (Array.isArray(record.richText)) return record.richText.map((part: unknown) => typeof part === "object" && part !== null && "text" in part ? String((part as { text: unknown }).text) : "").join("");
            if ("result" in record) return String(record.result ?? "");
            return "";
          }
          return String(value);
        };
        sheet.eachRow({ includeEmpty: false }, (row) => {
          if (rows.length >= 80) return;
          const cells = Array.from({ length: 12 }, () => "");
          row.eachCell({ includeEmpty: true }, (cell, column) => { if (column <= 12) cells[column - 1] = displayCell(cell.value); });
          rows.push(cells);
        });
        setPreview({ type: "xlsx", sheet: sheet.name, rows });
      }
    } catch {
      setState("error");
    } finally {
      setState((current) => current === "busy" ? "idle" : current);
    }
  };
  return (
    <div className="assistant-file-card my-2 w-full border border-border rounded-xl bg-surface shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className="flex items-center justify-center w-9 h-9 rounded-md text-white text-[10px] font-bold tracking-wide shrink-0"
          style={{ background: info.color }}
        >
          {info.badge}
        </span>
        <button type="button" className="assistant-file-name flex flex-col min-w-0 flex-1 text-left bg-transparent border-0 cursor-pointer" onClick={() => void openFile()} disabled={state === "busy"}>
          <span className="text-[13px] font-semibold text-text-strong truncate">{filename}</span>
          <span className="text-[11px] text-text-muted">{info.kind} · click {ext === "pdf" || ext === "xlsx" ? "to preview" : "to download"}</span>
        </button>
        <button
          onClick={download}
          disabled={state === "busy"}
          className={`shrink-0 px-3 py-1.5 rounded-md text-[12px] font-semibold border transition-colors ${
            state === "done"
              ? "border-sage-dark text-sage-dark bg-transparent"
              : "border-brass bg-brass/15 text-text-strong hover:bg-brass/25"
          } disabled:opacity-60`}
        >
          {state === "busy" ? "Preparing…" : state === "done" ? "✓ Saved" : "Download"}
        </button>
      </div>
      {state === "error" && (
        <div className="px-3 pb-2 text-[11px] text-danger">
          Download failed — the link may have expired. Ask me to generate it again.
        </div>
      )}
      <Dialog open={preview !== null} onClose={() => setPreview(null)} fullWidth maxWidth={preview?.type === "pdf" ? "xl" : "lg"} slotProps={{ paper: { sx: { height: { xs: "100dvh", sm: preview?.type === "pdf" ? "90vh" : "80vh" }, maxHeight: { xs: "100dvh" }, width: { xs: "100vw", sm: "auto" }, maxWidth: { xs: "100vw" }, m: { xs: 0 }, borderRadius: { xs: 0, sm: 3 }, overflow: "hidden" } } }}>
        <DialogTitle className="assistant-preview-title" sx={{ display: "flex", alignItems: "center", gap: 1.5, pr: 1.5, borderBottom: "1px solid var(--border)" }}>
          <DescriptionOutlinedIcon sx={{ color: "var(--brand-gold-deep)" }} />
          <span className="min-w-0 flex-1 truncate text-[14px]">{filename}{preview?.type === "xlsx" ? ` · ${preview.sheet}` : ""}</span>
          <Button size="small" startIcon={<DownloadOutlinedIcon />} onClick={() => void download()}>Download</Button>
          <IconButton onClick={() => setPreview(null)} aria-label="Close preview" size="small"><CloseIcon /></IconButton>
        </DialogTitle>
        <DialogContent sx={{ p: 0, background: "var(--surface-alt)" }}>
          {preview?.type === "pdf" && <iframe title={`Preview of ${filename}`} src={preview.url} className="w-full h-full border-0 bg-white" />}
          {preview?.type === "xlsx" && (
            <div className="h-full overflow-auto p-4">
              <p className="m-0 mb-3 text-[12px] text-text-muted">Showing the first 80 rows and 12 columns from this sheet.</p>
              <div className="overflow-auto rounded-xl border border-border bg-surface">
                <table className="assistant-preview-table"><tbody>{preview.rows.map((row, ri) => <tr key={ri}>{row.map((cell, ci) => <td key={ci}>{cell}</td>)}</tr>)}</tbody></table>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Renders assistant text, turning markdown tables into real tables and export links into
 *  download cards (everything else stays pre-wrapped text) — no markdown library, just the
 *  | table convention every agent's system prompt is told to use. Shared by AnalyticsChat
 *  and the main /assistant page so agent output renders identically wherever it's reached
 *  from, and so the link-safety check in isSafeUrl only has to be gotten right once. */
export function RichText({ text, chartExtra }: { text: string; /** Optional actions rendered under each chart (given the parsed chart). */ chartExtra?: (spec: ChartSpec) => React.ReactNode }) {
  // Charts the Reports Agent built arrive as ```asc-chart fenced JSON — pulled out first so the
  // table/link handling below never sees (or mangles) the spec. A spec that fails validation is
  // dropped rather than shown as raw JSON.
  const parts = text.split(/```asc-chart\n([\s\S]*?)\n```/g);
  if (parts.length === 1) return <RichTextBody text={text} />;
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) {
          const t = part.replace(/^\n+|\n+$/g, "");
          return t ? <RichTextBody key={i} text={t} /> : null;
        }
        const spec = parseChartSpec(part);
        return spec ? <ChartBlock key={i} spec={spec} extra={chartExtra?.(spec)} /> : null;
      })}
    </>
  );
}

function RichTextBody({ text }: { text: string }) {
  const lines = text.split("\n");
  const blocks: ({ type: "text"; lines: string[] } | { type: "table"; rows: string[][] })[] = [];
  for (const line of lines) {
    const isRow = line.trim().startsWith("|") && line.includes("|", 2);
    const last = blocks[blocks.length - 1];
    if (isRow) {
      const cells = line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      if (cells.every((c) => /^:?-{2,}:?$/.test(c))) continue; // separator row
      if (last?.type === "table") last.rows.push(cells);
      else blocks.push({ type: "table", rows: [cells] });
    } else if (last?.type === "text") {
      last.lines.push(line);
    } else {
      blocks.push({ type: "text", lines: [line] });
    }
  }
  const renderText = (t: string, keyBase: string) => {
    // Bare export URLs (a model may skip markdown) get wrapped so they card-render too. The
    // true filename (and so its real format — Excel/PDF/PowerPoint) only exists server-side
    // behind this opaque id, so the fallback label stays format-neutral rather than guessing.
    t = t.replace(
      /(?<!\]\()(?:https?:\/\/[^\s)]+)?(\/api\/v1\/msl\/analytics\/export\/[a-f0-9]+)/g,
      (full, path) => `[Download export](${path})`
    );
    // Markdown links: export links become authenticated download buttons; others open —
    // but only if the URL passes isSafeUrl, otherwise the raw markdown text is left alone
    // rather than becoming a live (and potentially unsafe) anchor.
    const parts = t.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, pi) => {
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (!m) return <Fragment key={`${keyBase}-${pi}`}>{part}</Fragment>;
      const [, label, url] = m;
      if (!isSafeUrl(url)) return <Fragment key={`${keyBase}-${pi}`}>{part}</Fragment>;
      if (url.includes("/api/") && url.includes("/export/")) {
        return <ExportFileCard key={`${keyBase}-${pi}`} url={url} filename={label} />;
      }
      return (
        <a key={`${keyBase}-${pi}`} href={url} target="_blank" rel="noreferrer" className="underline text-brass">
          {label}
        </a>
      );
    });
  };

  return (
    <>
      {blocks.map((b, i) =>
        b.type === "text" ? (
          <Fragment key={i}>{renderText(b.lines.join("\n"), String(i))}</Fragment>
        ) : (
          <ChatTable key={i} rows={b.rows} />
        )
      )}
    </>
  );
}
