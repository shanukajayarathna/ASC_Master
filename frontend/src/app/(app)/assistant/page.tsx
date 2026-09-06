"use client";

import MicButton from "@/components/assistant/MicButton";
import { parseClarify, RichText } from "@/components/assistant/RichText";
import MarketPulseTicker from "@/components/home/MarketPulseTicker";
import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import type { ActivitySummary, ChatMessage, Conversation, ProviderStatus } from "@/types/api";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import GavelOutlinedIcon from "@mui/icons-material/GavelOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import type { SvgIconComponent } from "@mui/icons-material";

// Matches AssistantController's own MaxMessageLength — the server is the real limit, this
// just gives instant feedback instead of a 400 after typing something huge.
const MAX_MESSAGE_LENGTH = 8000;

const SUGGESTED_PROMPTS = [
  "Compare the last two sales",
  "How accurate were our valuations?",
  "Which broker performed best this sale?",
  "Show me the top prices",
];

type AgentKey = "general" | "auction" | "analytics" | "reports";

interface AgentInfo {
  key: AgentKey;
  name: string;
  description: string;
  icon: SvgIconComponent;
  image?: string;
  gradient: number;
}

// Copy pulled verbatim from each agent's own backend `Description` property
// (Modules/Agents/{GeneralAgent,AuctionAgent,AnalyticsAgent}.cs) — not reworded, so this
// tile grid never overstates what a given agent actually does. Images reuse already-vetted
// nav.ts photos for the closest matching concept (General -> AI Assistant's own tile,
// Analytics -> the Analysis tile, already themed "distribution, breakdowns, data-quality");
// Auction has no existing vetted photo, so it uses the same plain icon-on-gradient fallback
// ModuleTile already uses for tiles with no image, rather than sourcing an unvetted one.
const AGENTS: AgentInfo[] = [
  {
    key: "general",
    name: "General Assistant",
    description:
      "Answers questions about lots, valuations, sale comparisons, broker performance, market insights, reports, and uploaded documents, grounded in the platform's own data.",
    icon: AutoAwesomeOutlinedIcon,
    image: "https://images.unsplash.com/photo-1644088379091-d574269d422f",
    gradient: 5,
  },
  {
    key: "auction",
    name: "Auction Agent",
    description:
      "Specializes in tea auction and sale intelligence — prices, grades, gardens, brokers and buyers, price rankings, and sale-to-sale comparisons — grounded in ASC's own catalogue data.",
    icon: GavelOutlinedIcon,
    gradient: 8,
  },
  {
    key: "analytics",
    name: "Analytics Agent",
    description:
      "Market analytics over 13 years of Colombo auction history — quantities, proceeds, averages, broker/grade/elevation/buyer breakdowns, mark histories, and Tea Board national averages.",
    icon: InsightsOutlinedIcon,
    image: "https://images.unsplash.com/photo-1666875753105-c63a6f3bdc86",
    gradient: 3,
  },
  {
    key: "reports",
    name: "Reports Agent",
    description:
      "Finds and explains reports — saved/automated report outputs, or a fresh executive, broker, grade, category, garden, classification, or valuation report generated on the spot from a catalogue's live data.",
    icon: DescriptionOutlinedIcon,
    gradient: 4,
  },
];

/** One agent row — same clean bordered-row pattern as the Knowledge Base rewrite
 *  (description + button on the left, name centered in the middle, a real image or
 *  icon-on-gradient fallback on the right), not a glass/poster tile. */
function AgentRow({ agent, onChat }: { agent: AgentInfo; onChat: () => void }) {
  const Icon = agent.icon;
  return (
    <div className="flex items-stretch gap-4 border border-border rounded-[var(--radius-lg)] bg-surface p-4 min-h-[132px]">
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">Agent</span>
        <h3 className="font-display text-[15px] font-semibold m-0 text-text-strong sm:hidden">{agent.name}</h3>
        <p className="text-[13px] text-text-muted leading-relaxed m-0 line-clamp-3">{agent.description}</p>
        <div>
          <Button size="small" variant="outlined" startIcon={<Icon fontSize="small" />} onClick={onChat} sx={{ mt: 0.5 }}>
            Chat with this agent
          </Button>
        </div>
      </div>

      <div className="w-[200px] shrink-0 hidden sm:flex items-center justify-center text-center px-3 border-l border-r border-border">
        <h3 className="font-display text-[16px] font-semibold m-0 text-text-strong leading-snug">{agent.name}</h3>
      </div>

      <div className="w-[140px] shrink-0 relative rounded-[var(--radius-md)] overflow-hidden">
        {agent.image ? (
          <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${agent.image})` }} />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: `var(--tile-gradient-${agent.gradient})` }}>
            <Icon sx={{ fontSize: 30, color: "#fff" }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Mark Intelligence, folded in as an agent-adjacent insights panel (not a chat agent —
 *  it has no IAgent backing it) — a real live summary line from the same activity data
 *  its own Activity Alerts tab uses, not a bare link. */
function MarkIntelligenceRow({ summary }: { summary: ActivitySummary | null }) {
  return (
    <div className="flex items-stretch gap-4 border border-border rounded-[var(--radius-lg)] bg-surface p-4 min-h-[132px]">
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">Insights</span>
        <h3 className="font-display text-[15px] font-semibold m-0 text-text-strong sm:hidden">Mark Intelligence</h3>
        <p className="text-[13px] text-text-muted leading-relaxed m-0">
          {summary
            ? `${summary.atRisk} mark${summary.atRisk === 1 ? "" : "s"} at risk, ${summary.lost} lost, ${summary.newlyIncoming30d} newly incoming in the last 30 days.`
            : "Plantations, factories and marks — current broker(s) and history of change."}
        </p>
        <div>
          <Button
            component={Link}
            href="/mark-intelligence"
            size="small"
            variant="outlined"
            startIcon={<AccountTreeOutlinedIcon fontSize="small" />}
            sx={{ mt: 0.5 }}
          >
            Open Mark Intelligence
          </Button>
        </div>
      </div>

      <div className="w-[200px] shrink-0 hidden sm:flex items-center justify-center text-center px-3 border-l border-r border-border">
        <h3 className="font-display text-[16px] font-semibold m-0 text-text-strong leading-snug">Mark Intelligence</h3>
      </div>

      <div className="w-[140px] shrink-0 relative rounded-[var(--radius-md)] overflow-hidden flex items-center justify-center" style={{ background: "var(--tile-gradient-2)" }}>
        <AccountTreeOutlinedIcon sx={{ fontSize: 30, color: "#fff" }} />
      </div>
    </div>
  );
}

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
  const [provider, setProvider] = useState("local");
  // Which agent a fresh conversation starts with — picked from the empty-state's own
  // agent rows below, or "general" (this page's long-standing default, unchanged).
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>("general");
  const [activitySummary, setActivitySummary] = useState<ActivitySummary | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    api.listConversations().then(setConversations).catch(() => {});
    api.getActivitySummary().then(setActivitySummary).catch(() => {});
    api.getProviderStatuses().then((ps) => {
      setProviders(ps);
      // Land on a provider that's actually usable — "local" (Ollama) first while the hosted
      // free tiers are quota-limited and OpenAI isn't configured, rather than silently sitting
      // on an unconfigured default until the user notices and switches it manually.
      const configured = ps.filter((p) => p.configured).map((p) => p.key);
      const preferred = ["local", "gemini", "groq", "openai"];
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

    try {
      const res = await api.sendAgentChatMessage(selectedAgent, text, activeId ?? undefined, provider, activeCatalogueId ?? undefined);
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
    <div className="chat-vh flex flex-col">
      <PageHeader
        title="AI Assistant"
        subtitle="Four specialist agents over this sale's data, the full auction archive, your documents, and saved reports — plus Market Pulse and Mark Intelligence. Read-only — it can't edit anything."
        actions={
          <>
            {messages.length > 0 && (
              <Chip size="small" label={`Agent: ${AGENTS.find((a) => a.key === selectedAgent)?.name ?? "General Assistant"}`} />
            )}
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
            <IconButton
              size="small"
              onClick={() => {
                setActiveId(null);
                setSelectedAgent("general");
              }}
              aria-label="New chat"
            >
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </>
        }
      />

      <div className="flex-1 min-h-0 overflow-y-auto border border-border rounded-[var(--radius-lg)] bg-surface p-4 flex flex-col gap-3">
        {messages.length === 0 && (
          <div className="flex flex-col gap-3">
            <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">Pick an agent, or just start typing below</span>
            {AGENTS.map((agent) => (
              <AgentRow key={agent.key} agent={agent} onChat={() => setSelectedAgent(agent.key)} />
            ))}

            <div className="border border-border rounded-[var(--radius-lg)] overflow-hidden">
              <MarketPulseTicker variant="dashboard" />
            </div>
            <MarkIntelligenceRow summary={activitySummary} />

            <div className="flex flex-col items-center gap-3 text-text-muted text-[13px] pt-2">
              <span>
                Chatting with <strong>{AGENTS.find((a) => a.key === selectedAgent)?.name}</strong> — ask something, or try:
              </span>
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
          </div>
        )}
        {messages.map((m) => {
          // Auction/Analytics can both return markdown tables and a CLARIFY: line (see
          // RichText's own doc comment) — parsed at render time rather than stored, since
          // ChatMessage (a shared, persisted type) has no `clarify` field of its own.
          const { text, clarify } = m.role === "assistant" ? parseClarify(m.content) : { text: m.content, clarify: undefined };
          return (
            <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"} gap-1`}>
              <div
                className={`max-w-[80%] rounded-lg px-3.5 py-2.5 text-[13px] leading-relaxed whitespace-pre-wrap ${
                  m.role === "user" ? "bg-brass/15 text-text-strong" : "bg-surface-alt text-text"
                }`}
              >
                {m.role === "assistant" ? <RichText text={text} /> : text}
              </div>
              {clarify && (
                <div className="max-w-[80%] text-[12px] text-text-muted px-1">
                  {clarify.question} ({clarify.options.join(" / ")})
                </div>
              )}
              {m.role === "assistant" && m.provider && (
                <span className="text-[11px] text-text-muted px-1">
                  {providers.find((p) => p.key === m.provider)?.displayName ?? m.provider}
                </span>
              )}
            </div>
          );
        })}
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
        <div className="mt-3 p-3 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>
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
          slotProps={{ htmlInput: { maxLength: MAX_MESSAGE_LENGTH } }}
        />
        <Button type="submit" variant="contained" color="primary" disabled={sending || !input.trim()} aria-busy={sending}>
          <SendOutlinedIcon fontSize="small" />
        </Button>
      </form>
    </div>
  );
}
