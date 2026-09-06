"use client";

import { api } from "@/lib/api";
import { parseClarify, RichText } from "@/components/assistant/RichText";
import { brokerCode } from "@/lib/brokers";
import type { MslAnalyticsFilter } from "@/types/api";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
  /** Structured clarifying question parsed from a CLARIFY: line (Claude-style options). */
  clarify?: { question: string; options: string[]; answered?: string };
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
          maxLength={8000}
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
