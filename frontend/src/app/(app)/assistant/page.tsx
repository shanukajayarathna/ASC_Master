"use client";

import MicButton from "@/components/assistant/MicButton";
import { parseChartSpec } from "@/components/assistant/ChartBlock";
import { parseClarify, RichText } from "@/components/assistant/RichText";
import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { ActivitySummary, ChatMessage, Conversation, ProviderStatus } from "@/types/api";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import BookmarkBorderOutlinedIcon from "@mui/icons-material/BookmarkBorderOutlined";
import CheckIcon from "@mui/icons-material/Check";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SvgIconComponent } from "@mui/icons-material";

// Matches AssistantController's own MaxMessageLength — the server is the real limit, this
// just gives instant feedback instead of a 400 after typing something huge.
const MAX_MESSAGE_LENGTH = 8000;
const COUNTER_THRESHOLD = 6000;
const AGENT_MAP_KEY = "asc.assistant.conversationAgents";

type AgentKey = "general" | "auction" | "analytics" | "reports";

interface AgentInfo {
  key: AgentKey;
  name: string;
  /** One-line summary for the picker card. */
  short: string;
  /** Verbatim from each agent's own backend `Description` (Modules/Agents/*.cs) — shown as the
   *  card's tooltip so the picker never overstates what an agent does. */
  description: string;
  icon: SvgIconComponent;
  prompts: string[];
}

const AGENTS: AgentInfo[] = [
  {
    key: "general",
    name: "General Assistant",
    short: "Lots, valuations, brokers, reports and your documents.",
    description:
      "Answers questions about lots, valuations, sale comparisons, broker performance, market insights, reports, and uploaded documents, grounded in the platform's own data.",
    icon: AutoAwesomeOutlinedIcon,
    prompts: [
      "Compare the last two sales",
      "How accurate were our valuations?",
      "Which broker performed best this sale?",
      "Show me the top prices",
    ],
  },
  {
    key: "auction",
    name: "Auction Agent",
    short: "Prices, grades, gardens, buyers and sale-to-sale comparisons.",
    description:
      "Specializes in tea auction and sale intelligence — prices, grades, gardens, brokers and buyers, price rankings, and sale-to-sale comparisons — grounded in ASC's own catalogue data.",
    icon: GavelOutlinedIcon,
    prompts: ["Show me the top prices", "Which gardens fetched the highest prices?", "Compare the last two sales", "Who were the top buyers?"],
  },
  {
    key: "analytics",
    name: "Analytics Agent",
    short: "13 years of Colombo auction history and Tea Board averages.",
    description:
      "Market analytics over 13 years of Colombo auction history — quantities, proceeds, averages, broker/grade/elevation/buyer breakdowns, mark histories, and Tea Board national averages.",
    icon: InsightsOutlinedIcon,
    prompts: [
      "Average price by elevation over the last 5 years",
      "Broker market share this year vs last year",
      "Quantity and proceeds trend by sale",
      "How do we compare to the Tea Board national average?",
    ],
  },
  {
    key: "reports",
    name: "Reports Agent",
    short: "Custom reports with charts, saved reports, or a fresh report from live data.",
    description:
      "Finds and explains reports — saved/automated report outputs, or a fresh executive, broker, grade, category, garden, classification, or valuation report generated on the spot from a catalogue's live data — and builds custom cross-broker tables and charts (bar, stacked, share-of-total, line, pie) from the full auction archive on request.",
    icon: DescriptionOutlinedIcon,
    prompts: [
      "How is off-grade quantity shared among brokers?",
      "Broker share of off-grade quantity over the last 6 sales, as a stacked chart",
      "Trend of average price by broker over the last 8 sales",
      "Generate an executive report for this sale",
    ],
  },
];

const MODULE_LINKS = [
  { label: "Valuation Centre", href: "/valuation" },
  { label: "Reports", href: "/reports" },
  { label: "Broker Comparison", href: "/broker" },
  { label: "Market Intelligence", href: "/market" },
];

const agentByKey = (k: AgentKey) => AGENTS.find((a) => a.key === k) ?? AGENTS[0];

// The backend doesn't return which agent a conversation used, so remember it locally — lets an
// old conversation reopen showing (and continuing with) the agent that started it.
function readAgentMap(): Record<string, AgentKey> {
  try {
    return JSON.parse(localStorage.getItem(AGENT_MAP_KEY) ?? "{}");
  } catch {
    return {};
  }
}
function rememberAgent(conversationId: string, agent: AgentKey) {
  try {
    localStorage.setItem(AGENT_MAP_KEY, JSON.stringify({ ...readAgentMap(), [conversationId]: agent }));
  } catch {
    /* storage unavailable — falls back to the default agent on reopen */
  }
}

const timeLabel = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
};

const HISTORY_GROUPS = ["Today", "Yesterday", "Previous 7 days", "Older"] as const;

function historyGroup(iso: string, now: number): (typeof HISTORY_GROUPS)[number] {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "Older";
  const startOfToday = new Date(now).setHours(0, 0, 0, 0);
  const dayMs = 86_400_000;
  if (d.getTime() >= startOfToday) return "Today";
  if (d.getTime() >= startOfToday - dayMs) return "Yesterday";
  if (d.getTime() >= startOfToday - 7 * dayMs) return "Previous 7 days";
  return "Older";
}

function AgentCard({ agent, selected, onSelect }: { agent: AgentInfo; selected: boolean; onSelect: () => void }) {
  const Icon = agent.icon;
  return (
    <Tooltip title={agent.description} placement="top" enterDelay={600} describeChild>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={selected}
        className={`text-left flex flex-col gap-2 rounded-[var(--radius-lg)] border p-2.5 sm:p-3.5 transition-colors cursor-pointer ${
          selected ? "border-brass bg-brass/10 ring-1 ring-brass" : "border-border bg-surface hover:bg-surface-alt"
        }`}
      >
        <span className="flex items-center gap-2">
          <span
            className={`flex items-center justify-center w-8 h-8 rounded-md ${selected ? "bg-brass text-white" : "bg-surface-alt text-text-muted"}`}
          >
            <Icon sx={{ fontSize: 18 }} />
          </span>
          <span className="font-display text-[14px] font-semibold text-text-strong flex-1">{agent.name}</span>
          {selected && <CheckIcon sx={{ fontSize: 16 }} className="text-brass" />}
        </span>
        <span className="hidden sm:block text-[12.5px] text-text-muted leading-snug">{agent.short}</span>
      </button>
    </Tooltip>
  );
}

/** Saves an answer that contains a chart as a custom report (Saved Reports). A deliberate click by
 *  the user — the assistant itself stays read-only and never saves anything. */
function SaveReportButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const save = async () => {
    const first = text.match(/```asc-chart\n([\s\S]*?)\n```/);
    const suggested = (first && parseChartSpec(first[1])?.title) || "Custom report";
    const title = window.prompt("Save this report as:", suggested)?.trim();
    if (!title) return;
    setState("saving");
    try {
      await api.saveCustomReport(title, text);
      setState("saved");
    } catch {
      setState("error");
    }
  };
  const hint =
    state === "saved" ? "Saved — find it under Saved Reports" : state === "error" ? "Couldn't save — try again" : "Save as a report";
  return (
    <Tooltip title={hint}>
      <span>
        <IconButton size="small" aria-label="Save report" onClick={save} disabled={state === "saving" || state === "saved"} sx={{ p: 0.5 }}>
          {state === "saved" ? <CheckIcon sx={{ fontSize: 14 }} /> : <BookmarkBorderOutlinedIcon sx={{ fontSize: 14 }} />}
        </IconButton>
      </span>
    </Tooltip>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Tooltip title={copied ? "Copied" : "Copy"}>
      <IconButton
        size="small"
        aria-label="Copy message"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          } catch {
            /* clipboard blocked — nothing to recover */
          }
        }}
        sx={{ p: 0.5 }}
      >
        {copied ? <CheckIcon sx={{ fontSize: 14 }} /> : <ContentCopyOutlinedIcon sx={{ fontSize: 14 }} />}
      </IconButton>
    </Tooltip>
  );
}

export default function AssistantPage() {
  // The Topbar's active sale rides along with every chat message, so the assistant knows
  // what "the current sale" means without a tool round-trip.
  const { activeCatalogueId, activeCatalogue } = useCatalogue();
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [provider, setProvider] = useState("local");
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>("general");
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyQuery, setHistoryQuery] = useState("");
  const [slow, setSlow] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
    api.getActivitySummary().then(setActivitySummary).catch(() => {});
    api.getProviderStatuses().then((ps) => {
      setProviders(ps);
      // Land on a provider that's actually usable — OpenAI when configured, otherwise "local"
      // (Ollama) first while the hosted free tiers are quota-limited, rather than silently
      // sitting on an unconfigured default until the user notices and switches it manually.
      const configured = ps.filter((p) => p.configured).map((p) => p.key);
      const preferred = ["openai", "local", "gemini", "groq"];
      const ordered = [...preferred, ...configured.filter((k) => !preferred.includes(k))].filter((k) => configured.includes(k));
      if (ordered.length > 0) setProvider(ordered[0]);
    }).catch(() => {});
    // Prefill handed over from the dashboard's Ask ASC box (?q=...) — lands in the input
    // for review, never auto-sent. Read from window.location rather than useSearchParams
    // so this statically-prerendered page needs no Suspense boundary.
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInput(q);
      window.history.replaceState(null, "", "/assistant"); // don't re-prefill on refresh
    }
    // History panel starts open on wide screens, closed on narrow ones.
    setHistoryOpen(window.matchMedia("(min-width: 1024px)").matches);
  }, []);

  useEffect(() => {
    if (!activeId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMessages([]);
      return;
    }
    let cancelled = false;
    setLoadingMessages(true);
    setError(null);
    api
      .getConversationMessages(activeId)
      .then((ms) => !cancelled && setMessages(ms))
      .catch(() => !cancelled && setError("Couldn't load this conversation. Try selecting it again."))
      .finally(() => !cancelled && setLoadingMessages(false));
    return () => {
      cancelled = true;
    };
  }, [activeId]);

  // After a while with no reply, say so — local models can take minutes, and a bare
  // "thinking…" looks identical to a hung request.
  useEffect(() => {
    if (!sending) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSlow(false);
      return;
    }
    const t = setTimeout(() => setSlow(true), 20_000);
    return () => clearTimeout(t);
  }, [sending]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const openConversation = (id: string | null) => {
    setActiveId(id);
    setSelectedAgent(id ? (Object.entries(readAgentMap()).find(([k]) => k === id)?.[1] ?? "general") : "general");
  };

  const sendText = async (raw: string) => {
    const text = raw.trim();
    if (!text || sending) return;

    const optimisticUser: ChatMessage = {
      // eslint-disable-next-line react-hooks/purity -- sendText only ever runs from a click/submit handler, never during render
      id: `pending-${Date.now()}`,
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
    };
    setMessages((m) => [...m, optimisticUser]);
    setInput("");
    setSending(true);
    setError(null);
    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await api.sendAgentChatMessage(selectedAgent, text, activeId ?? undefined, provider, activeCatalogueId ?? undefined, controller.signal);
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
        rememberAgent(res.conversationId, selectedAgent);
        setActiveId(res.conversationId);
        api.listConversations().then(setConversations).catch(() => {});
      }
    } catch (e) {
      // Take the optimistic bubble back out and return the text to the composer, so a failed
      // send never costs the user what they typed.
      setMessages((m) => m.filter((x) => x.id !== optimisticUser.id));
      setInput((prev) => prev || text);
      if (controller.signal.aborted) {
        setError("Stopped waiting. The assistant may still finish in the background — check your history in a moment.");
      } else {
        setError(e instanceof Error ? e.message : "Couldn't reach the assistant.");
      }
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  };

  const deleteConversation = async (id: string) => {
    if (!window.confirm("Delete this conversation? This can't be undone.")) return;
    try {
      await api.deleteConversation(id);
      setConversations((c) => c.filter((x) => x.id !== id));
      if (activeId === id) openConversation(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't delete the conversation.");
    }
  };

  const agent = agentByKey(selectedAgent);
  const isEmpty = messages.length === 0 && !loadingMessages;
  const lastAssistantIdx = messages.reduce((acc, m, i) => (m.role === "assistant" ? i : acc), -1);
  const query = historyQuery.trim().toLowerCase();
  const visibleConversations = query ? conversations.filter((c) => c.title.toLowerCase().includes(query)) : conversations;
  // eslint-disable-next-line react-hooks/purity -- only buckets already-loaded rows by day; a stale "now" is harmless
  const now = Date.now();
  const groupedConversations = HISTORY_GROUPS.map((label) => ({
    label,
    items: visibleConversations.filter((c) => historyGroup(c.createdAt, now) === label),
  })).filter((g) => g.items.length > 0);

  return (
    <div className="chat-vh flex flex-col">
      <PageHeader
        title="AI Assistant"
        subtitle="Specialist agents over this sale's data, the full auction archive, your documents and saved reports. Read-only — it can't edit anything."
        actions={
          <>
            <Select
              size="small"
              value={provider}
              onChange={(e) => setProvider(e.target.value)}
              sx={{ minWidth: 120, fontSize: 13 }}
              inputProps={{ "aria-label": "AI provider" }}
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
            <Tooltip title={historyOpen ? "Hide history" : "Show history"}>
              <IconButton size="small" onClick={() => setHistoryOpen((o) => !o)} aria-label="Toggle conversation history" aria-pressed={historyOpen}>
                <HistoryOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Tooltip title="New chat">
              <IconButton size="small" onClick={() => openConversation(null)} aria-label="New chat">
                <AddCommentOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        }
      />

      <div className="flex-1 min-h-0 flex flex-col lg:flex-row gap-3">
        {historyOpen && (
          <aside
            aria-label="Conversation history"
            className="lg:w-64 shrink-0 max-h-40 lg:max-h-none overflow-y-auto border border-border rounded-[var(--radius-lg)] bg-surface p-2 flex flex-col gap-0.5"
          >
            <Button size="small" startIcon={<AddCommentOutlinedIcon fontSize="small" />} onClick={() => openConversation(null)} sx={{ justifyContent: "flex-start", mb: 0.5 }}>
              New conversation
            </Button>
            {conversations.length > 6 && (
              <TextField
                size="small"
                value={historyQuery}
                onChange={(e) => setHistoryQuery(e.target.value)}
                placeholder="Search conversations"
                slotProps={{ htmlInput: { "aria-label": "Search conversations" } }}
                sx={{ mb: 0.5, "& input": { fontSize: 13 } }}
              />
            )}
            {conversations.length === 0 && <span className="text-[12px] text-text-muted px-2 py-1">No conversations yet.</span>}
            {conversations.length > 0 && groupedConversations.length === 0 && (
              <span className="text-[12px] text-text-muted px-2 py-1">No matches.</span>
            )}
            {groupedConversations.map((g) => (
              <div key={g.label} className="flex flex-col gap-0.5">
                <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted px-2 pt-2 pb-0.5">{g.label}</span>
                {g.items.map((c) => (
                  <div
                    key={c.id}
                    className={`group flex items-center gap-1 rounded-md pr-1 ${c.id === activeId ? "bg-brass/15" : "hover:bg-surface-alt"}`}
                  >
                    <button
                      type="button"
                      onClick={() => openConversation(c.id)}
                      aria-current={c.id === activeId}
                      className="flex-1 min-w-0 text-left px-2 py-1.5 text-[13px] text-text truncate cursor-pointer"
                      title={c.title}
                    >
                      {c.title}
                    </button>
                    <IconButton
                      size="small"
                      aria-label={`Delete "${c.title}"`}
                      onClick={() => deleteConversation(c.id)}
                      className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                    >
                      <DeleteOutlineIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </div>
                ))}
              </div>
            ))}
          </aside>
        )}

        <section className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded-[var(--radius-lg)] bg-surface p-4 flex flex-col gap-4">
            {loadingMessages && <span className="text-[13px] text-text-muted">Loading conversation…</span>}

            {isEmpty && (
              <div className="flex flex-col gap-4 max-w-3xl w-full mx-auto my-auto py-2">
                <div className="text-center flex flex-col gap-1">
                  <h2 className="font-display text-[22px] font-semibold m-0 text-text-strong">What would you like to know?</h2>
                </div>

                <div className="grid grid-cols-2 gap-2 sm:gap-3" role="group" aria-label="Choose an agent">
                  {AGENTS.map((a) => (
                    <AgentCard key={a.key} agent={a} selected={a.key === selectedAgent} onSelect={() => setSelectedAgent(a.key)} />
                  ))}
                </div>

                <div className="flex flex-col items-center gap-2">
                  <span className="text-[12px] text-text-muted">
                    Suggestions for <strong>{agent.name}</strong>
                  </span>
                  <div className="flex flex-wrap justify-center gap-2">
                    {agent.prompts.map((prompt) => (
                      <Chip key={prompt} label={prompt} size="small" variant="outlined" clickable disabled={sending} onClick={() => sendText(prompt)} />
                    ))}
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-center gap-2 text-[12px] text-text-muted">
                  <span>Or go straight to</span>
                  {MODULE_LINKS.map((l) => (
                    <Chip key={l.href} component={Link} href={l.href} label={l.label} size="small" clickable />
                  ))}
                </div>

                <Link
                  href="/mark-intelligence"
                  className="flex items-center gap-3 rounded-[var(--radius-lg)] border border-border px-3.5 py-2.5 hover:bg-surface-alt no-underline"
                >
                  <AccountTreeOutlinedIcon sx={{ fontSize: 20 }} className="text-text-muted" />
                  <span className="flex-1 min-w-0 flex flex-col">
                    <span className="text-[13px] font-semibold text-text-strong">Mark Intelligence</span>
                    <span className="text-[12px] text-text-muted">
                      {activitySummary
                        ? `${activitySummary.atRisk} mark${activitySummary.atRisk === 1 ? "" : "s"} at risk, ${activitySummary.lost} lost, ${activitySummary.newlyIncoming30d} newly incoming in the last 30 days.`
                        : "Plantations, factories and marks — current broker(s) and history of change."}
                    </span>
                  </span>
                  <span className="text-[12px] text-brass">Open →</span>
                </Link>
              </div>
            )}

            {messages.length > 0 && (
              <div className="flex items-center gap-2 text-[12px] text-text-muted">
                <Chip size="small" label={agent.name} icon={<agent.icon fontSize="small" />} />
                <span>Start a new chat to switch agent.</span>
              </div>
            )}

            <div role="log" aria-live="polite" className="flex flex-col gap-4">
              {messages.map((m, i) => {
                // Auction/Analytics can both return markdown tables and a CLARIFY: line (see
                // RichText's own doc comment) — parsed at render time rather than stored, since
                // ChatMessage (a shared, persisted type) has no `clarify` field of its own.
                const isUser = m.role === "user";
                const { text, clarify } = isUser ? { text: m.content, clarify: undefined } : parseClarify(m.content);
                const hasChart = !isUser && text.includes("```asc-chart");
                return (
                  <div key={m.id} className={`group flex flex-col ${isUser ? "items-end" : "items-start"} gap-1`}>
                    <div
                      className={`${hasChart ? "w-full" : "max-w-[88%] sm:max-w-[80%]"} rounded-lg px-4 py-3 text-[14px] leading-relaxed whitespace-pre-wrap break-words ${
                        isUser ? "bg-brass/15 text-text-strong" : "bg-surface-alt text-text"
                      }`}
                    >
                      {isUser ? text : <RichText text={text} />}
                    </div>
                    {clarify && (
                      <div className="max-w-[88%] sm:max-w-[80%] flex flex-col gap-1.5 px-1">
                        <span className="text-[12.5px] text-text-muted">{clarify.question}</span>
                        <div className="flex flex-wrap gap-2">
                          {clarify.options.map((opt) => (
                            <Chip
                              key={opt}
                              label={opt}
                              size="small"
                              variant="outlined"
                              clickable
                              disabled={sending || i !== lastAssistantIdx}
                              onClick={() => sendText(opt)}
                            />
                          ))}
                        </div>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 px-1 text-[11px] text-text-muted">
                      {!isUser && m.provider && <span>{providers.find((p) => p.key === m.provider)?.displayName ?? m.provider}</span>}
                      <span>{timeLabel(m.createdAt)}</span>
                      {!isUser && <CopyButton text={text.replace(/```asc-chart\n[\s\S]*?\n```/g, "[chart]")} />}
                      {hasChart && <SaveReportButton text={text} />}
                    </div>
                  </div>
                );
              })}
            </div>

            {sending && (
              <div className="flex justify-start">
                <div className="rounded-lg px-4 py-3 bg-surface-alt flex items-center gap-2">
                  <span className="flex items-center gap-1" aria-hidden="true">
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                    <span className="typing-dot" />
                  </span>
                  <span className="text-[12px] text-text-muted">
                    {slow ? `${agent.name} is still working — local models can take a few minutes.` : `${agent.name} is thinking…`}
                  </span>
                  {slow && (
                    <Button size="small" onClick={() => abortRef.current?.abort()} sx={{ ml: 1 }}>
                      Stop waiting
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div ref={bottomRef} />
          </div>

          {error && (
            <div role="alert" className="mt-3 p-3 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              sendText(input);
            }}
            className="mt-3 flex items-end gap-2.5"
          >
            {/* Voice input: the transcript lands here for review — never auto-sent. */}
            <MicButton
              disabled={sending}
              onTranscript={(text) => setInput((prev) => (prev.trim() ? `${prev.trim()} ${text}` : text))}
            />
            <TextField
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  sendText(input);
                }
              }}
              placeholder={`Ask the ${agent.name} — English, සිංහල, தமிழ், or Singlish`}
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
              color="primary"
              disabled={sending || !input.trim()}
              aria-busy={sending}
              aria-label="Send message"
              sx={{ minWidth: 44, height: 40 }}
            >
              <SendOutlinedIcon fontSize="small" />
            </Button>
          </form>
          <div className="mt-1 px-1 text-[11px] text-text-muted flex flex-wrap justify-between gap-x-3">
            <span>
              {activeCatalogue
                ? `Asking about ${activeCatalogue.sourceName} · ${activeCatalogue.rowCount.toLocaleString()} lots`
                : "No sale selected — pick one in the top bar to ask about a specific sale."}
              {" · "}AI-generated: check key figures against the dashboard or reports.
            </span>
            <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
            {input.length >= COUNTER_THRESHOLD && (
              <span className="ml-auto">
                {input.length} / {MAX_MESSAGE_LENGTH}
              </span>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
