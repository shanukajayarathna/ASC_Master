"use client";

import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { ChatMessage, ChatScope, ProviderStatus } from "@/types/api";
import { useCallback, useEffect, useRef, useState } from "react";
import type { AgentKey } from "./agents";

/** OpenAI when configured, otherwise the local model first while hosted free tiers are quota-limited. */
const PREFERRED_PROVIDERS = ["openai", "local", "gemini", "groq"];

export function pickProvider(statuses: ProviderStatus[]): string | null {
  const configured = statuses.filter((p) => p.configured).map((p) => p.key);
  const ordered = [...PREFERRED_PROVIDERS, ...configured.filter((k) => !PREFERRED_PROVIDERS.includes(k))].filter((k) => configured.includes(k));
  return ordered[0] ?? null;
}

interface Options {
  /** The part of the archive to limit answers to; read each time a message is sent. */
  scope?: ChatScope | null;
  /** Called with each assistant reply as it arrives (used for optional read-aloud). */
  onReply?: (text: string) => void;
}

/**
 * One agent's conversation for a workspace. It talks to the same chat endpoint as the classic page, with the
 * Topbar's active sale attached, and can send a question handed over from the hub (`?send=1&q=`) exactly once,
 * after the provider list and active sale have loaded so the message goes out with the right context.
 */
export function useAgentChat(agent: AgentKey | "auto", { onReply, scope }: Options = {}) {
  const { activeCatalogueId, loading: catalogueLoading } = useCatalogue();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [slow, setSlow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState("local");
  const [providersReady, setProvidersReady] = useState(false);
  const [restoredText, setRestoredText] = useState<string | null>(null);
  const conversationId = useRef<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const pendingQ = useRef<string | null>(null);
  /** The agent that answered last, so a short follow-up stays with it (universal chat only). */
  const lastAgent = useRef<string | null>(null);
  const onReplyRef = useRef(onReply);
  const scopeRef = useRef(scope ?? null);
  useEffect(() => {
    onReplyRef.current = onReply;
    scopeRef.current = scope ?? null;
  });

  useEffect(() => {
    api
      .getProviderStatuses()
      .then((ps) => {
        setProviders(ps);
        const best = pickProvider(ps);
        if (best) setProvider(best);
      })
      .catch(() => {})
      .finally(() => setProvidersReady(true));

    const params = new URLSearchParams(window.location.search);
    const q = params.get("q");
    if (q) {
      if (params.get("send") === "1") pendingQ.current = q;
      // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL once on mount
      else setRestoredText(q); // prefill only — never auto-sent
      window.history.replaceState(null, "", window.location.pathname); // a refresh must not resend
    }
  }, []);

  // After a while with no reply, say so — local models can take minutes.
  useEffect(() => {
    if (!sending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlow(false);
      return;
    }
    const timer = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(timer);
  }, [sending]);

  const send = useCallback(
    async (raw: string, override?: AgentKey): Promise<boolean> => {
      const text = raw.trim();
      if (!text || sending) return false;
      const optimistic: ChatMessage = {
        // eslint-disable-next-line react-hooks/purity -- only runs from a handler, never during render
        id: `pending-${Date.now()}`,
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      setMessages((m) => [...m, optimistic]);
      setSending(true);
      setError(null);
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const res = await api.sendAgentChatMessage(override ?? agent, text, conversationId.current ?? undefined, provider, activeCatalogueId ?? undefined, controller.signal, override ? undefined : (lastAgent.current ?? undefined), scopeRef.current);
        const answeredBy = override ?? res.agent ?? null;
        if (answeredBy) lastAgent.current = answeredBy;
        conversationId.current = res.conversationId;
        setMessages((m) => [...m, { id: `reply-${Date.now()}`, role: "assistant", content: res.reply, createdAt: new Date().toISOString(), provider: res.provider, sources: res.sources, agent: answeredBy }]);
        onReplyRef.current?.(res.reply);
        return true;
      } catch (e) {
        // A failed send never costs the user what they typed.
        setMessages((m) => m.filter((x) => x.id !== optimistic.id));
        setRestoredText(text);
        setError(
          controller.signal.aborted
            ? "Stopped waiting. The assistant may still finish in the background — check your history in a moment."
            : e instanceof Error ? e.message : "Couldn't reach the assistant.",
        );
        return false;
      } finally {
        setSending(false);
      }
    },
    [agent, provider, activeCatalogueId, sending],
  );

  useEffect(() => {
    const q = pendingQ.current;
    if (!q || !providersReady || catalogueLoading) return;
    pendingQ.current = null; // once only
    void send(q);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fires exactly when the two readiness flags flip
  }, [providersReady, catalogueLoading]);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    conversationId.current = null;
    lastAgent.current = null;
    setMessages([]);
    setError(null);
  }, []);

  return {
    messages,
    sending,
    slow,
    error,
    providers,
    provider,
    setProvider,
    send,
    stop: () => abortRef.current?.abort(),
    reset,
    restoredText,
    clearRestoredText: () => setRestoredText(null),
  };
}
