"use client";

import { api } from "@/lib/api";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import { useEffect, useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

/**
 * The Analysis page's docked chatbot — routed to the Analytics Agent (13 years of MSL
 * auction history via rollup-backed tools). The selected sale is prefixed into the first
 * message of a conversation so "this sale" resolves without the model guessing.
 */
export default function AnalyticsChat({ year, saleNo }: { year: number; saleNo: number }) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversationId, setConversationId] = useState<string | undefined>();
  // The gateway's default provider may be unconfigured (e.g. no OpenAI key while Groq/
  // Gemini keys exist) — pick the first configured one explicitly.
  const [provider, setProvider] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api
      .getProviderStatuses()
      .then((ps) => {
        const configured = ps.filter((p) => p.configured);
        // Gemini first: the most reliable tool-caller among the configured providers
        // (Groq's Llama intermittently emits malformed tool-call syntax).
        setProvider((configured.find((p) => p.key === "gemini") ?? configured[0])?.key);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, busy]);

  const send = async () => {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const context =
        conversationId === undefined
          ? `(Context: the user is viewing sale ${saleNo === 0 ? `PVT/${year}` : `${saleNo} of ${year}`} on the Analysis screen.)\n`
          : "";
      const res = await api.sendAgentChatMessage("analytics", context + text, conversationId, provider);
      setConversationId(res.conversationId);
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
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
    "Summarize this sale",
    "Which broker had the best average?",
    "Compare this sale with the same sale last year",
    "Top buyers this sale",
  ];

  return (
    <div className="border border-border rounded-md bg-surface flex flex-col h-[520px]">
      <div className="px-3.5 py-2.5 border-b border-border">
        <div className="font-display text-[13.5px] font-semibold text-text-strong">Ask the Analytics Agent</div>
        <div className="text-[11px] text-text-muted">13 years of auction history · Tea Board averages · read-only</div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 flex flex-col gap-2.5">
        {messages.length === 0 && (
          <div className="flex flex-col gap-1.5">
            <p className="text-[12px] text-text-muted m-0">Try one of these:</p>
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
          <div
            key={i}
            className={`max-w-[92%] rounded-md px-3 py-2 text-[12.5px] whitespace-pre-wrap ${
              m.role === "user"
                ? "self-end bg-brass/15 text-text-strong"
                : "self-start border border-border bg-surface-sunken/30 text-text"
            }`}
          >
            {m.content}
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
          onClick={send}
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
