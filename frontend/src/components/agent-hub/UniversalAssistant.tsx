"use client";

import PageHeader from "@/components/shared/PageHeader";
import { useCatalogue } from "@/context/CatalogueContext";
import type { ChartSpec } from "@/components/assistant/ChartBlock";
import { api } from "@/lib/api";
import type { ChatScope, ForYou, Lot } from "@/types/api";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import BookmarkBorderOutlinedIcon from "@mui/icons-material/BookmarkBorderOutlined";
import InsertChartOutlinedIcon from "@mui/icons-material/InsertChartOutlined";
import VolumeOffOutlinedIcon from "@mui/icons-material/VolumeOffOutlined";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";
import AgentTag from "./AgentTag";
import AgentUsageBadge from "./AgentUsageBadge";
import ChartActions from "./ChartActions";
import ChatPanel from "./ChatPanel";
import LibraryDrawer from "./LibraryDrawer";
import LotCards, { lotNumberIn, useLotsFor } from "./LotCards";
import { drillPrompt, explainChartPrompt } from "./PinnedBoard";
import ProviderSelect from "./ProviderSelect";
import ReportCanvas from "./ReportCanvas";
import ScopeControl from "./ScopeControl";
import { readScope, saveScope } from "./scope";
import { archiveGap, parseSaleName, useLatestArchivedSale } from "./archive";
import { answerTitle, pinId, usePins } from "./pins";
import { DEFAULT_STATE, type BuilderState } from "./reportBuilder";
import { useAgentChat } from "./useAgentChat";
import { useReducedMotion } from "./useHubEnv";
import VoiceOrb, { type OrbState } from "./VoiceOrb";
import { applyVoiceCommand, parseVoiceCommand } from "./voiceCommand";
import { useMicLevel, useSpeech } from "./voice";
import "./workspace.css";

const STARTERS = [
  "Compare brokers over the last 12 sales",
  "Show the top prices this sale",
  "What is the default penalty for a late buyer?",
  "Build a weekly broker report",
];
const CHART_MARKER = /```asc-chart\n[\s\S]*?\n```/g;

/** The builder settings a request implies (group, period, measure…), so the report canvas opens already set up for it. */
export function canvasStateFor(question: string, scope: ChatScope | null = null): BuilderState {
  const cmd = parseVoiceCommand(question);
  const state = applyVoiceCommand(DEFAULT_STATE, cmd);
  // A period chosen in the scope control is the default; a period named in the question itself wins.
  return scope ? { ...state, range: scope, period: cmd.patch.period ?? "scope" } : state;
}

/** Lot cards under an answer about a lot: looked up from the lot number in the question, shown only if the sale has it. */
function LotsUnder({ question, onAsk, busy }: { question: string; onAsk: (q: string) => void; busy: boolean }) {
  const find = useLotsFor();
  const number = lotNumberIn(question);
  const [lots, setLots] = useState<Lot[]>([]);

  useEffect(() => {
    if (!number) return;
    let cancelled = false;
    find(number).then((l) => !cancelled && setLots(l)).catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- look the lot up once per question
  }, [number]);

  return lots.length > 0 ? <LotCards lots={lots} onAsk={onAsk} busy={busy} /> : null;
}

/**
 * The one assistant. Ask in plain words; the assistant works out which specialist should answer (a small tag shows
 * which, and lets you re-ask with another), and asks a short question first when the request is too open. Results
 * arrive as cards in the conversation — charts with their actions, lots with theirs — and anything that needs room
 * opens beside the chat (the report canvas) or in the library, so the screen stays a single conversation.
 */
export default function UniversalAssistant() {
  const reduced = useReducedMotion();
  const speech = useSpeech();
  const { activeCatalogue } = useCatalogue();
  const latestArchived = useLatestArchivedSale();
  const gap = archiveGap(latestArchived, parseSaleName(activeCatalogue?.sourceName));

  const [voiceReplies, setVoiceReplies] = useState(false);
  const voiceRepliesRef = useRef(false);
  useEffect(() => {
    voiceRepliesRef.current = voiceReplies;
  });
  // The chosen part of the archive (default: nothing is limited). Remembered per browser; read after mount so the server render matches.
  const [scope, setScopeState] = useState<ChatScope | null>(null);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restore a saved choice from browser storage
    setScopeState(readScope());
  }, []);
  const setScope = (next: ChatScope | null) => {
    setScopeState(next);
    saveScope(next);
  };
  const chat = useAgentChat("auto", {
    scope,
    onReply: (text) => {
      if (voiceRepliesRef.current) speech.speak(text);
    },
  });
  const { pins, pin, unpin, isPinned } = usePins();

  // "For you": the reader's own recent questions, refreshed whenever the conversation is empty (start, new chat).
  const [forYou, setForYou] = useState<ForYou | null>(null);
  const emptyChat = chat.messages.length === 0;
  const refreshForYou = () => {
    api.getForYou().then(setForYou).catch(() => {});
  };
  useEffect(() => {
    if (!emptyChat) return;
    let cancelled = false;
    api.getForYou().then((f) => !cancelled && setForYou(f)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [emptyChat]);

  const [listening, setListening] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [canvas, setCanvas] = useState<{ open: boolean; initial: BuilderState }>({ open: false, initial: DEFAULT_STATE });
  const [notice, setNotice] = useState<string | null>(null);

  // Personal cards first (your own recent questions), padded with the generic ones; new users see just the generic ones.
  const recent = forYou?.personalise ? forYou.recent : [];
  const starters = [...recent, ...STARTERS.filter((g) => !recent.some((r) => r.toLowerCase() === g.toLowerCase()))].slice(0, 4);
  const personal = !!forYou?.personalise && !!forYou.firstName;
  const hint = recent.length > 0
    ? `Pick up where you left off, or ask something new.${forYou && forYou.pinCount > 0 ? ` You have ${forYou.pinCount} pinned insight${forYou.pinCount === 1 ? "" : "s"} in your Library.` : ""}`
    : "Ask about prices, brokers, lots, by-laws or reports — in English, සිංහල or தமிழ்.";

  const micLevel = useMicLevel(listening);
  const orb: OrbState = listening ? "listening" : chat.sending ? "thinking" : speech.speaking ? "speaking" : "idle";
  const getLevel = orb === "listening" ? micLevel : speech.getLevel;

  const ask = (question: string) => void chat.send(question);
  const openCanvas = (question: string) => setCanvas({ open: true, initial: canvasStateFor(question, scope) });

  const tellPin = (result: "added" | "exists" | "full" | "error") =>
    setNotice(result === "added" ? "Pinned to your library." : result === "exists" ? "Already in your library." : result === "full" ? "Your library is full — remove a pin first." : "Couldn't pin that — try again.");

  return (
    <div className="chat-vh flex flex-col workspace universal" data-agent="general">
      <PageHeader
        title="AI Assistant"
        subtitle="Ask in plain words. The right specialist answers, and I'll ask if I need to know more."
        actions={
          <>
            <AgentUsageBadge agent="all" />
            <ProviderSelect chat={chat} />
            <span className="ws-mini-orb" title={orb}>
              <VoiceOrb state={orb} getLevel={getLevel} reduced={reduced} />
              <span className="sr-only" role="status">{orb === "idle" ? "" : orb}</span>
            </span>
            {speech.supported && (
              <Tooltip title={voiceReplies ? "Replies are read aloud — turn off" : "Read replies aloud"}>
                <IconButton size="small" onClick={() => { if (voiceReplies) speech.cancel(); setVoiceReplies((v) => !v); }} aria-label="Read replies aloud" aria-pressed={voiceReplies} sx={{ width: 44, height: 44 }}>
                  {voiceReplies ? <VolumeUpOutlinedIcon fontSize="small" /> : <VolumeOffOutlinedIcon fontSize="small" />}
                </IconButton>
              </Tooltip>
            )}
            <Button size="small" variant="outlined" startIcon={<InsertChartOutlinedIcon fontSize="small" />} onClick={() => setCanvas({ open: true, initial: canvasStateFor("", scope) })} sx={{ minHeight: 44 }}>
              Report canvas
            </Button>
            <Button size="small" variant="outlined" startIcon={<BookmarkBorderOutlinedIcon fontSize="small" />} onClick={() => setLibraryOpen(true)} sx={{ minHeight: 44 }}>
              Library
            </Button>
            <Tooltip title="New chat">
              <IconButton size="small" onClick={() => { speech.cancel(); chat.reset(); }} aria-label="New chat" sx={{ width: 44, height: 44 }}>
                <AddCommentOutlinedIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </>
        }
      />

      <div className="universal-body">
        <ChatPanel
          chat={chat}
          speech={speech}
          prompts={starters}
          emptyTitle={personal ? `Welcome back, ${forYou?.firstName}` : "What would you like to know?"}
          emptyHint={hint}
          aboveComposer={
            <div className="ws-scopebar">
              <ScopeControl scope={scope} onChange={setScope} />
              {gap && (
                <span className="ws-scopebar-note" role="note">
                  Archive figures run to sale {gap.archived}; the active sale ({gap.active}) comes from its catalogue.
                </span>
              )}
            </div>
          }
          placeholder="Ask anything — English, සිංහල, தமிழ், or Singlish"
          onListeningChange={setListening}
          chartExtra={(spec: ChartSpec, ctx) => (
            <ChartActions
              spec={spec}
              busy={chat.sending}
              pinned={isPinned(pinId("chart", JSON.stringify(spec)))}
              onAsk={ask}
              onPin={async () => tellPin(await pin({ key: pinId("chart", JSON.stringify(spec)), kind: "chart", title: spec.title, chart: spec }))}
              onEdit={() => openCanvas(ctx.question)}
              explainPrompt={explainChartPrompt}
              drillPrompt={drillPrompt}
            />
          )}
          messageExtra={({ text, question, agent, fromRouter }) => {
            const plain = text.replace(CHART_MARKER, "").trim();
            const key = pinId("answer", plain);
            const canPin = plain && !text.includes("```asc-chart") && !fromRouter;
            return (
              <>
                {agent && !fromRouter && <AgentTag agent={agent} disabled={chat.sending} onReask={(a) => void chat.send(question, a)} />}
                {canPin && (
                  <Chip
                    size="small"
                    variant="outlined"
                    clickable
                    disabled={isPinned(key)}
                    label={isPinned(key) ? "Pinned" : "Pin"}
                    onClick={async () => tellPin(await pin({ key, kind: "answer", title: answerTitle(plain), text: plain.slice(0, 600) }))}
                    sx={{ height: 24, fontSize: 11 }}
                  />
                )}
                {(agent === "reports" || agent === "analytics") && !text.includes("```asc-chart") && !fromRouter && (
                  <Chip size="small" variant="outlined" clickable label="Open in report canvas" onClick={() => openCanvas(question)} sx={{ height: 24, fontSize: 11 }} />
                )}
              </>
            );
          }}
          belowMessage={({ agent, question }) => (agent === "auction" ? <LotsUnder question={question} onAsk={ask} busy={chat.sending} /> : null)}
        />
        <p className="ws-lots-note m-0" role="status" aria-live="polite">{notice}</p>
      </div>

      <LibraryDrawer open={libraryOpen} onClose={() => setLibraryOpen(false)} pins={pins} onUnpin={unpin} onAsk={ask} busy={chat.sending} onPersonalisationChanged={refreshForYou} />
      <ReportCanvas open={canvas.open} initial={canvas.initial} onClose={() => setCanvas((c) => ({ ...c, open: false }))} />
    </div>
  );
}
