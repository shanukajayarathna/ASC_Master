"use client";

import { api } from "@/lib/api";
import { useState } from "react";
import { Fragment } from "react";

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
        clarify: { question: parsed.question, options: parsed.options.slice(0, 4).map(String) },
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
function ChatTable({ rows }: { rows: string[][] }) {
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
      <div className="flex items-center gap-2 px-2 py-1 border-t border-border/60 bg-surface-sunken/30">
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
  const dot = filename.lastIndexOf(".");
  const ext = dot >= 0 ? filename.slice(dot + 1).toLowerCase() : "";
  const info = EXPORT_KINDS[ext] ?? { badge: ext ? ext.toUpperCase().slice(0, 4) : "FILE", color: "#5B7A57", kind: "File" };
  const download = async () => {
    setState("busy");
    try {
      await api.downloadAuthedFile(url.startsWith("http") ? new URL(url).pathname : url, filename);
      setState("done");
    } catch {
      setState("error");
    }
  };
  return (
    <div className="my-1.5 w-full border border-border rounded-lg bg-surface shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className="flex items-center justify-center w-9 h-9 rounded-md text-white text-[10px] font-bold tracking-wide shrink-0"
          style={{ background: info.color }}
        >
          {info.badge}
        </span>
        <span className="flex flex-col min-w-0 flex-1">
          <span className="text-[12.5px] font-semibold text-text-strong truncate">{filename}</span>
          <span className="text-[10.5px] text-text-muted">{info.kind} · link expires in ~20 min</span>
        </span>
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
    </div>
  );
}

/** Renders assistant text, turning markdown tables into real tables and export links into
 *  download cards (everything else stays pre-wrapped text) — no markdown library, just the
 *  | table convention every agent's system prompt is told to use. Shared by AnalyticsChat
 *  and the main /assistant page so agent output renders identically wherever it's reached
 *  from, and so the link-safety check in isSafeUrl only has to be gotten right once. */
export function RichText({ text }: { text: string }) {
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
