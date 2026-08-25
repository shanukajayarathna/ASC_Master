"use client";

import { api } from "@/lib/api";
import { brokerCode } from "@/lib/brokers";
import type { MslAnalyticsFilter } from "@/types/api";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { Fragment, useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Structured clarifying question parsed from a CLARIFY: line (Claude-style options). */
  clarify?: { question: string; options: string[]; answered?: string };
}

/** Splits an assistant reply into display text + a structured CLARIFY block, if present. */
function parseClarify(reply: string): { text: string; clarify?: { question: string; options: string[] } } {
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

/** Human-readable summary of the active filtration — the agent's situational context. */
function describeFilter(f: MslAnalyticsFilter): string {
  const parts: string[] = [];
  if (f.years?.length) parts.push(`year ${f.years.join(", ")}`);
  if (f.saleNos?.length) parts.push(`sale ${f.saleNos.join(", ")}`);
  else if (f.years?.length) parts.push("whole year (no single sale selected)");
  if (f.months?.length) parts.push(`months ${f.months.join(",")}`);
  if (f.brokers?.length) parts.push(`brokers ${f.brokers.map(brokerCode).join(", ")}`);
  if (f.elevations?.length) parts.push(`elevation ${f.elevations.join(", ")}`);
  if (f.categories?.length) parts.push(`category ${f.categories.join(", ")}`);
  if (f.grades?.length) parts.push(`grades ${f.grades.slice(0, 6).join(", ")}${f.grades.length > 6 ? "…" : ""}`);
  if (f.marks?.length) parts.push(`marks ${f.marks.slice(0, 4).join(", ")}${f.marks.length > 4 ? "…" : ""}`);
  if (f.buyers?.length) parts.push(`${f.buyers.length} buyer(s) selected`);
  if (f.saleType) parts.push(f.saleType === "public" ? "public auction only" : "private sales only");
  if (f.soldStatus) parts.push(`${f.soldStatus} lots only`);
  return parts.length ? parts.join("; ") : "no filters (whole archive)";
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
      await api.downloadTableAsExcel(headers, body, `asc-analytics-${stamp()}.xlsx`);
    } catch {
      /* surfaced by the button returning to idle; retry is the recovery */
    } finally {
      setBusy(false);
    }
  };
  const asCsv = () => {
    const esc = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
    const csv = rows.map((r) => r.map(esc).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `asc-analytics-${stamp()}.csv`;
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

/** Badge/color/kind-label per export format — the agent now generates Excel, PDF and
 *  PowerPoint files, so the card can no longer hard-code "XLSX"/"Excel workbook". */
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

/** Renders assistant text, turning markdown tables into real tables (everything else
 *  stays pre-wrapped text). No markdown library — just the | table convention. */
function RichText({ text }: { text: string }) {
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
    // Markdown links: export links become authenticated download buttons; others open.
    const parts = t.split(/(\[[^\]]+\]\([^)]+\))/g);
    return parts.map((part, pi) => {
      const m = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
      if (!m) return <Fragment key={`${keyBase}-${pi}`}>{part}</Fragment>;
      const [, label, url] = m;
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

/**
 * The Analysis page's docked chatbot — routed to the Analytics Agent (13 years of MSL
 * auction history via rollup-backed tools). The ACTIVE FILTRATION is passed as context on
 * the first message and again whenever it changes mid-conversation, so "this slice" always
 * means what the user is looking at.
 */
export default function AnalyticsChat({ filter, onClose }: { filter: MslAnalyticsFilter; onClose?: () => void }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  const [provider, setProvider] = useState<string | undefined>();
  const [fallbackProviders, setFallbackProviders] = useState<string[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const lastContextRef = useRef<string>("");

  useEffect(() => {
    api
      .getProviderStatuses()
      .then((ps) => {
        const configured = ps.filter((p) => p.configured).map((p) => p.key);
        // "local" (Ollama) first while the hosted free tiers (Gemini/Groq) are quota-limited
        // and OpenAI isn't plugged in yet — zero per-token cost, so it's the safe standing
        // default; hosted providers stay in the fallback chain for when local isn't running.
        const preferred = ["local", "gemini", "groq", "openai"];
        const ordered = [...preferred, ...configured.filter((k) => !preferred.includes(k))].filter((k) => configured.includes(k));
        setProvider(ordered[0]);
        setFallbackProviders(ordered.slice(1));
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async (preset?: string) => {
    const text = (preset ?? input).trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      // Context goes with the first message AND again whenever the filters changed since
      // the last message — the agent always knows the slice on screen.
      const summary = describeFilter(filter);
      const context = summary !== lastContextRef.current
        ? `(Context: the user's Analysis screen is filtered to: ${summary}.)\n`
        : "";
      lastContextRef.current = summary;
      // Provider resilience: a dead/over-quota provider falls through to the next
      // configured one automatically, and the working provider becomes the new default.
      let lastError: unknown;
      let sent = false;
      for (const p of [provider, ...fallbackProviders].filter(Boolean) as string[]) {
        try {
          const res = await api.sendAgentChatMessage("analytics", context + text, conversationId, p);
          setConversationId(res.conversationId);
          const parsed = parseClarify(res.reply);
          setMessages((m) => [...m, { role: "assistant", content: parsed.text, clarify: parsed.clarify }]);
          if (p !== provider) {
            setFallbackProviders((f) => [provider!, ...f.filter((x) => x !== p)]);
            setProvider(p);
          }
          sent = true;
          break;
        } catch (e) {
          lastError = e;
        }
      }
      if (!sent) throw lastError;
    } catch (e) {
      setMessages((m) => [
        ...m,
        { role: "assistant", content: e instanceof Error ? `Something went wrong: ${e.message}` : "Something went wrong." },
      ]);
    } finally {
      setBusy(false);
    }
  };

  const suggestions = [
    "Summarize this slice",
    "Which broker had the best average?",
    "Compare with the same sale last year",
    "Top buyers as a table",
  ];

  return (
    <div className="border border-border rounded-md bg-surface flex flex-col h-[520px]">
      <div className="px-3.5 py-2.5 border-b border-border flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-display text-[13.5px] font-semibold text-text-strong">Ask the Analytics Agent</div>
          <div className="text-[11px] text-text-muted">13 years of auction history · English / සිංහල / தமிழ் · read-only</div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Minimize chat"
            className="text-text-muted hover:text-text text-[16px] leading-none px-1">−</button>
        )}
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] text-text-muted m-0">Knows what you&apos;ve filtered. Try:</p>
            {suggestions.map((s) => (
              <button
                key={s}
                onClick={() => setInput(s)}
                className="text-left text-[12px] px-2.5 py-1.5 border border-border rounded bg-surface-sunken/40 hover:border-brass text-text"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`max-w-[92%] flex flex-col gap-1.5 ${m.role === "user" ? "self-end items-end" : "self-start items-start"}`}>
            {m.content.trim().length > 0 && (
              <div
                className={`rounded-md px-3 py-2 text-[12.5px] whitespace-pre-wrap ${
                  m.role === "user"
                    ? "bg-brass/15 text-text-strong"
                    : "border border-border bg-surface-sunken/30 text-text"
                }`}
              >
                {m.role === "assistant" ? <RichText text={m.content} /> : m.content}
              </div>
            )}
            {m.clarify && (
              <div className="border border-brass/50 rounded-md bg-surface px-3 py-2 flex flex-col gap-1.5 w-full">
                <span className="text-[12px] font-semibold text-text-strong">{m.clarify.question}</span>
                <div className="flex flex-wrap gap-1.5">
                  {m.clarify.options.map((opt) => (
                    <button
                      key={opt}
                      disabled={busy || m.clarify!.answered !== undefined}
                      onClick={() => {
                        setMessages((msgs) => msgs.map((x, xi) => (xi === i && x.clarify ? { ...x, clarify: { ...x.clarify, answered: opt } } : x)));
                        send(opt);
                      }}
                      className={`px-2.5 py-1 rounded-full border text-[12px] transition-colors ${
                        m.clarify!.answered === opt
                          ? "border-brass bg-brass/20 text-text-strong font-semibold"
                          : m.clarify!.answered !== undefined
                            ? "border-border text-text-muted opacity-50"
                            : "border-brass/60 text-text hover:bg-brass/10"
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="self-start text-[12px] text-text-muted animate-pulse">Analyzing…</div>}
      </div>

      <div className="p-2.5 border-t border-border flex gap-2">
        <input
          className="flex-1 border border-border rounded-md bg-surface px-2.5 py-1.5 text-[12.5px] text-text outline-none focus:border-brass"
          placeholder="e.g. How did KENILWORTH average this year?"
          value={input}
          disabled={busy}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button
          onClick={() => send()}
          disabled={busy || !input.trim()}
          className="px-3 rounded-md border border-brass bg-brass/10 text-text-strong disabled:opacity-40"
          aria-label="Send"
        >
          <SendOutlinedIcon fontSize="small" />
        </button>
      </div>
    </div>
  );
}
