"use client";

import PageHeader from "@/components/shared/PageHeader";
import { api } from "@/lib/api";
import type { ChatMessage, Conversation } from "@/types/api";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useEffect, useRef, useState } from "react";

export default function AssistantPage() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
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

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    const text = input.trim();
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
      const res = await api.sendChatMessage(text, activeId ?? undefined);
      setMessages((m) => [
        ...m,
        { id: `reply-${Date.now()}`, role: "assistant", content: res.reply, createdAt: new Date().toISOString() },
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

  return (
    <div className="flex flex-col" style={{ height: "calc(100vh - 140px)" }}>
      <PageHeader
        title="AI Assistant"
        subtitle="Ask about lots, valuations, and uploaded documents. Read-only — it can't edit anything."
        actions={
          <>
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
                <MenuItem key={c.id} value={c.id}>
                  {c.title}
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
          <div className="flex-1 flex items-center justify-center text-text-muted text-[13px]">
            No messages yet — ask something about a lot, a valuation, or an uploaded document.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-[13.5px] leading-relaxed whitespace-pre-wrap ${
                m.role === "user" ? "bg-brass/15 text-text-strong" : "bg-surface-alt text-text"
              }`}
            >
              {m.content}
            </div>
          </div>
        ))}
        {sending && (
          <div className="flex justify-start">
            <div className="rounded-lg px-3.5 py-2.5 bg-surface-alt">
              <CircularProgress size={14} sx={{ color: "var(--liquor)" }} />
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && (
        <div className="mt-3 p-3 rounded border border-danger bg-danger-light text-[13px] text-liquor-dark">{error}</div>
      )}

      <form onSubmit={send} className="mt-3 flex gap-2.5">
        <TextField
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask the assistant…"
          size="small"
          fullWidth
          disabled={sending}
        />
        <Button type="submit" variant="contained" color="primary" disabled={sending || !input.trim()}>
          <SendOutlinedIcon fontSize="small" />
        </Button>
      </form>
    </div>
  );
}
