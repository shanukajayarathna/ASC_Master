"use client";

import MicButton from "@/components/assistant/MicButton";
import { parseClarify, RichText } from "@/components/assistant/RichText";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { useEffect, useRef, useState, type ReactNode } from "react";
import BylawsClauseDialog from "./BylawsClauseDialog";
import { useReducedMotion } from "./useHubEnv";
import type { useAgentChat } from "./useAgentChat";
import type { useSpeech } from "./voice";

const MAX_MESSAGE_LENGTH = 8000;

/** The user's turns since the previous real answer, joined — so a tapped option ("2026") still carries the request it answers. */
export function requestBefore(messages: readonly { role: string; content: string; provider?: string | null }[], index: number): string {
  const parts: string[] = [];
  for (let j = index - 1; j >= 0; j--) {
    const x = messages[j];
    if (x.role === "assistant" && x.provider !== "router") break;
    if (x.role === "user") parts.unshift(x.content);
  }
  return parts.join(", ");
}

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

/** What a workspace may want to know about the answer it is decorating. */
export interface MessageContext {
  /** The user's message this answer replies to. */
  question: string;
  /** Which agent answered (universal chat); null when unknown. */
  agent: string | null;
  /** True for a clarifying question the router asked itself (no agent answered it). */
  fromRouter: boolean;
}

interface ChatPanelProps {
  chat: ReturnType<typeof useAgentChat>;
  speech: ReturnType<typeof useSpeech>;
  prompts: readonly string[];
  emptyTitle: string;
  /** One line under the empty-state title. */
  emptyHint?: string;
  placeholder: string;
  /** Mirrors the mic's listening state up to the workspace (drives the status orb). */
  onListeningChange?: (listening: boolean) => void;
  /** Extra actions under each chart in an answer (e.g. Explain / Pin / drill-down). */
  chartExtra?: (spec: ChartSpec, context: MessageContext) => ReactNode;
  /** Extra chips in an answer's footer row (e.g. Pin). Given the answer's id and text. */
  messageExtra?: (message: { id: string; text: string } & MessageContext) => ReactNode;
  /** Block content under an answer's footer row (e.g. lot cards). */
  belowMessage?: (message: { id: string; text: string } & MessageContext) => ReactNode;
  /** Shown between the conversation and the composer (e.g. a hand-off suggestion). */
  aboveComposer?: ReactNode;
  /** Follow-up suggestions shown as buttons under the newest answer (only for a real answer, not a question). */
  nextSteps?: (message: { text: string } & MessageContext) => readonly string[];
}

/**
 * The conversation card and composer every workspace shares: messages (markdown tables, charts, clarify
 * chips), suggested prompts, read-aloud and copy on each answer, and a composer with the mic. The workspace
 * owns the chat state (so it can also send from elsewhere, e.g. a lot card) and passes it in.
 */
export default function ChatPanel({ chat, speech, prompts, emptyTitle, emptyHint, placeholder, onListeningChange, chartExtra, messageExtra, belowMessage, aboveComposer, nextSteps }: ChatPanelProps) {
  const reduced = useReducedMotion();
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [clause, setClause] = useState<string | null>(null);

  useEffect(() => {
    // Scroll only the conversation card (never the page) and only once there is something to follow.
    const el = scrollRef.current;
    if (el && (chat.messages.length > 0 || chat.sending)) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [chat.messages, chat.sending, reduced]);

  // Cards that load under an answer after it arrives (lots, charts) grow the log: stay at the bottom if the reader was there.
  useEffect(() => {
    const log = logRef.current;
    const box = scrollRef.current;
    if (!log || !box || typeof ResizeObserver === "undefined") return;
    let last = log.scrollHeight;
    const observer = new ResizeObserver(() => {
      const grew = log.scrollHeight - last;
      last = log.scrollHeight;
      const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight - grew < 160;
      if (grew > 0 && nearBottom) box.scrollTo({ top: box.scrollHeight, behavior: "auto" });
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  // A failed send (or a ?q= prefill) hands the text back to the composer.
  const { restoredText, clearRestoredText } = chat;
  useEffect(() => {
    if (restoredText === null) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- moving hook-owned text into the composer
    setInput((prev) => prev || restoredText);
    clearRestoredText();
  }, [restoredText, clearRestoredText]);

  const submit = async (text: string) => {
    if (!text.trim() || chat.sending) return;
    speech.cancel();
    setInput("");
    await chat.send(text);
    inputRef.current?.focus();
  };

  const focusComposer = () => inputRef.current?.focus();

  const copy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId((c) => (c === id ? null : c)), 1500);
    } catch {
      /* clipboard blocked — nothing to do */
    }
  };

  const isEmpty = chat.messages.length === 0;
  const lastAssistantIdx = chat.messages.reduce((acc, m, i) => (m.role === "assistant" ? i : acc), -1);

  return (
    <section className="min-w-0 min-h-0 flex flex-col" aria-label="Conversation">
      <div ref={scrollRef} className="chat-panel-scroll flex-1 min-h-0 overflow-y-auto border border-border rounded-[var(--radius-lg)] bg-surface p-4 flex flex-col gap-4">
        {isEmpty && !chat.sending && (
          <div className="flex flex-col items-center gap-3 my-auto py-2 text-center">
            <h2 className="font-display text-[22px] font-semibold m-0 text-text-strong">{emptyTitle}</h2>
            {emptyHint && <p className="m-0 text-[13px] text-text-muted max-w-xl">{emptyHint}</p>}
            <div className="ws-starters">
              {prompts.map((p) => (
                <button key={p} type="button" className="ws-starter" onClick={() => submit(p)}>
                  {p}
                </button>
              ))}
            </div>
          </div>
        )}

        <div ref={logRef} role="log" aria-live="polite" className="flex flex-col gap-4">
          {chat.messages.map((m, i) => {
            const isUser = m.role === "user";
            const question = requestBefore(chat.messages, i);
            const { text, clarify } = isUser ? { text: m.content, clarify: undefined } : parseClarify(m.content);
            const hasChart = !isUser && text.includes("```asc-chart");
            const showSteps = !isUser && !clarify && i === lastAssistantIdx && !chat.sending && m.provider !== "router";
            const steps = showSteps ? (nextSteps?.({ text, question, agent: m.agent ?? null, fromRouter: false }) ?? []) : [];
            return (
              <div key={m.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-1`}>
                <div
                  className={`chat-message-bubble ${isUser ? "chat-message-user" : "chat-message-assistant"} ${hasChart ? "w-full" : "max-w-[88%] sm:max-w-[80%]"} rounded-lg px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
                    isUser ? "bg-brass/15 text-text-strong" : "bg-surface-alt text-text"
                  }`}
                >
                  {isUser ? text : <RichText text={text} chartExtra={chartExtra ? (spec) => chartExtra(spec, { question, agent: m.agent ?? null, fromRouter: m.provider === "router" }) : undefined} />}
                </div>
                {clarify && (
                  <div className="max-w-[88%] sm:max-w-[80%] flex flex-col gap-1.5 px-1">
                    <span className="text-[12.5px] text-text-muted">{clarify.question}</span>
                    <div className="flex flex-wrap gap-2">
                      {clarify.options.map((opt) => (
                        <Chip key={opt} label={opt} size="small" variant="outlined" clickable disabled={chat.sending || i !== lastAssistantIdx} onClick={() => submit(opt)} />
                      ))}
                      {i === lastAssistantIdx && (
                        <Chip label="Other…" aria-label="Type your own answer" size="small" variant="outlined" clickable disabled={chat.sending} onClick={focusComposer} sx={{ borderStyle: "dashed" }} />
                      )}
                    </div>
                  </div>
                )}
                {!isUser && m.sources && m.sources.length > 0 && (
                  <ul className="ws-sources" aria-label="Sources">
                    {m.sources.map((src) => (
                      <li key={`${src.kind}-${src.label}-${src.detail ?? ""}`}>
                        {src.kind === "bylaws" && src.detail ? (
                          <button type="button" className="ws-source ws-source-link" onClick={() => setClause(src.detail!)} aria-label={`Open by-law section ${src.detail}`}>
                            Source · {src.label} · {src.detail}
                          </button>
                        ) : (
                          <span className="ws-source">Source · {src.label}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
                <div className="flex items-center gap-1.5 px-1 text-[11px] text-text-muted">
                  <span>{timeLabel(m.createdAt)}</span>
                  {!isUser && speech.supported && (
                    <Chip
                      size="small"
                      variant="outlined"
                      clickable
                      icon={<VolumeUpOutlinedIcon sx={{ fontSize: 14 }} />}
                      label="Read aloud"
                      onClick={() => speech.speak(text)}
                      sx={{ height: 24, fontSize: 11 }}
                    />
                  )}
                  {!isUser && (
                    <Chip
                      size="small"
                      variant="outlined"
                      clickable
                      icon={<ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />}
                      label={copiedId === m.id ? "Copied" : "Copy"}
                      onClick={() => copy(m.id, text.replace(/```asc-chart\n[\s\S]*?\n```/g, "[chart]"))}
                      sx={{ height: 24, fontSize: 11 }}
                    />
                  )}
                  {!isUser && messageExtra?.({ id: m.id, text, question, agent: m.agent ?? null, fromRouter: m.provider === "router" })}
                </div>
                {steps.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 px-1" role="group" aria-label="Next steps">
                    <span className="text-[12px] text-text-muted">Next:</span>
                    {steps.map((step) => (
                      <Chip key={step} label={step} size="small" variant="outlined" clickable onClick={() => void submit(step)} />
                    ))}
                  </div>
                )}
                {!isUser && belowMessage?.({ id: m.id, text, question, agent: m.agent ?? null, fromRouter: m.provider === "router" })}
              </div>
            );
          })}
        </div>

        {chat.sending && (
          <div className="flex justify-start">
            <div className="rounded-lg px-4 py-3 bg-surface-alt flex items-center gap-2">
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
              <span className="text-[12px] text-text-muted">
                {chat.slow ? "Still working — this request is taking longer than usual." : "Thinking…"}
              </span>
              {chat.slow && (
                <Button size="small" onClick={chat.stop} sx={{ ml: 1 }}>
                  Stop waiting
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {chat.error && (
        <div role="alert" className="mt-3 p-3 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">
          {chat.error}
        </div>
      )}

      <BylawsClauseDialog title={clause} onClose={() => setClause(null)} />
      {aboveComposer}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit(input);
        }}
        className="mt-3 flex items-end gap-2.5"
      >
        <MicButton
          large
          disabled={chat.sending}
          onListeningChange={onListeningChange}
          onTranscript={(spoken) => setInput((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken))}
        />
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit(input);
            }
          }}
          placeholder={placeholder}
          size="small"
          fullWidth
          multiline
          maxRows={6}
          inputRef={inputRef}
          slotProps={{ htmlInput: { maxLength: MAX_MESSAGE_LENGTH, "aria-label": "Message" } }}
        />
        <Button
          type="submit"
          variant="contained"
          disabled={chat.sending || !input.trim()}
          aria-busy={chat.sending}
          aria-label="Send message"
          sx={{ minWidth: 48, height: 44 }}
        >
          <SendOutlinedIcon fontSize="small" />
        </Button>
      </form>
      <p className="mt-1 px-1 text-[11px] text-text-muted m-0">AI-generated: check key figures against the dashboard or reports. Enter to send · Shift+Enter for a new line.</p>
    </section>
  );
}
