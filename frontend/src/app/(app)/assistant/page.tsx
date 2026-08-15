"use client";

import MicButton from "@/components/assistant/MicButton";
import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { ChatMessage, Conversation, ProviderStatus } from "@/types/api";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState } from "react";

const SUGGESTED_PROMPTS = [
  "Compare the last two sales",
  "How accurate were our valuations?",
  "Which broker performed best this sale?",
  "Show me the top prices",
];

export default function AssistantPage() {
  // The Topbar's active sale rides along with every chat message, so the assistant knows
  // what "the current sale" means without a tool round-trip.
  const { activeCatalogueId } = useCatalogue();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState("openai");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
    api.getProviderStatuses().then(setProviders).catch(() => {});
    // Prefill handed over from the dashboard's Ask ASC box (?q=...) — lands in the input
    // for review, never auto-sent. Read from window.location rather than useSearchParams
    // so this statically-prerendered page needs no Suspense boundary.
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput(q);
      window.history.replaceState(null, "", "/assistant"); // don't re-prefill on refresh
    }
  }, []);

  useEffect(() => {
    if (!activeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    api.getConversationMessages(activeId).then(setMessages).catch(() => {});
  }, [activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendText = async (text: string) => {
    text = text.trim();
    if (!text || sending) return;

    const optimisticUser: ChatMessage = {
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    setInput("");
    setSending(true);
    setError(null);

    try {
      const res = await api.sendChatMessage(text, activeId ?? undefined, provider, activeCatalogueId ?? undefined);
      setMessages((m) => [
        ...m,
        {
          id: `reply-${Date.now()}`,
          role: "assistant",
          content: res.reply,
          createdAt: new Date().toISOString(),
          provider: res.provider,
        },
      ]);
      if (!activeId) {
        setActiveId(res.conversationId);
        api.listConversations().then(setConversations).catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't reach the assistant.");
    } finally {
      setSending(false);
    }
  };

  const deleteConversation = async (id: string) => {
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    try {
      await api.deleteConversation(id);
      setConversations((c) => c.filter((x) => x.id !== id));
      if (activeId === id) setActiveId(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the conversation.");
    }
  };

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 140px)" }}>
      <PageHeader
        title="AI Assistant"
        subtitle="Ask about lots, valuations, and uploaded documents. Read-only — it can't edit anything."
        actions={
          <>
            <Select
              size="small"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              sx={{ minWidth: 120, fontSize: 13 }}
            >
              {(providers.length > 0 ? providers : [{ key: "openai", displayName: "OpenAI", model: null, configured: true }]).map(
                (p) => (
                  <MenuItem key={p.key} value={p.key} disabled={!p.configured}>
                    {p.displayName}
                    {!p.configured && " (not configured)"}
                  </MenuItem>
                ),
              )}
            </Select>
            <Select
              size="small"
              value={activeId ?? ""}
              onChange={(e) => setActiveId(e.target.value || null)}
              displayEmpty
              sx={{ minWidth: 200, fontSize: 13 }}
              renderValue={(v) => {
                if (!v) return <span className="text-text-muted">New conversation</span>;
                const c = conversations.find((x) => x.id === v);
                return c?.title ?? "…";
              }}
            >
              {conversations.map((c) => (
                <MenuItem key={c.id} value={c.id} className="flex items-center justify-between gap-3">
                  <span className="truncate">{c.title}</span>
                  <IconButton
                    size="small"
                    aria-label={`Delete "${c.title}"`}
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteConversation(c.id);
                    }}
                  >
                    <DeleteOutlineIcon fontSize="inherit" />
                  </IconButton>
                </MenuItem>
              ))}
            </Select>
            <IconButton size="small" onClick={() => setActiveId(null)} aria-label="New chat">
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded-lg bg-surface p-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted text-[13px]">
            <span>No messages yet — ask something about a lot, a valuation, or an uploaded document.</span>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTED_PROMPTS.map((prompt) => (
                <Chip
                  key={prompt}
                  label={prompt}
                  size="small"
                  variant="outlined"
                  clickable
                  disabled={sending}
                  onClick={() => sendText(prompt)}
                />
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"} gap-1`}>
            <div
              className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user" ? "bg-brass/15 text-text-strong" : "bg-surface-alt text-text"
              }`}
            >
              {m.content}
            </div>
            {m.role === "assistant" && m.provider && (
              <span className="text-[11px] text-text-muted px-1">
                {providers.find((p) => p.key === m.provider)?.displayName ?? m.provider}
              </span>
            )}
          </div>
        ))}
        {sending && (
          <div className="flex justify-start" aria-live="polite">
            <div className="rounded-lg px-3.5 py-2.5 bg-surface-alt flex items-center gap-2">
              <span className="flex items-center gap-1" aria-hidden="true">
                <span className="typing-dot" />
                <span className="typing-dot" />
                <span className="typing-dot" />
              </span>
              <span className="text-[12px] text-text-muted">ASC AI is thinking…</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mt-3 p-3 rounded border border-danger bg-danger-light text-[13px] text-liquor-dark">{error}</div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          sendText(input);
        }}
        className="mt-3 flex items-center gap-2.5"
      >
        {/* Voice input: the transcript lands here for review — never auto-sent. */}
        <MicButton
          disabled={sending}
          onTranscript={(text) => setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))}
        />
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask anything — English, සිංහල, தமிழ், or Singlish…"
          size="small"
          fullWidth
          disabled={sending}
        />
        <Button type="submit" variant="contained" color="primary" disabled={sending || !input.trim()} aria-busy={sending}>
          <SendOutlinedIcon fontSize="small" />
        </Button>
      </form>
    </div>
  );
}
