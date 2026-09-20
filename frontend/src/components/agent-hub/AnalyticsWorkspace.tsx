"use client";

import type { ChartSpec } from "@/components/assistant/ChartBlock";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import PushPinOutlinedIcon from "@mui/icons-material/PushPinOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useState } from "react";
import ChatPanel from "./ChatPanel";
import CompareBuilder from "./CompareBuilder";
import PinnedBoard, { drillPrompt, explainChartPrompt } from "./PinnedBoard";
import { answerTitle, pinId, usePins } from "./pins";
import ProviderSelect from "./ProviderSelect";
import { useAgentChat } from "./useAgentChat";
import type { OrbState } from "./VoiceOrb";
import { useSpeech } from "./voice";
import WorkspaceShell from "./WorkspaceShell";

const PROMPTS = [
  "Compare brokers over the last 12 sales",
  "Which grades gained the most this year?",
  "Top 10 marks by average price",
  "How did prices trend over 13 years?",
];
const DRILL_CHIPS = 6;
const CHART_MARKER = /```asc-chart\n[\s\S]*?\n```/g;

/**
 * The Analytics workspace: an analysis canvas. Ask a question (or use the Compare builder) and the agent
 * answers over the full 13-year archive with tables and charts; every chart offers Explain, Pin and a
 * drill-down into its categories, and pinned charts and answers collect on the board.
 */
export default function AnalyticsWorkspace() {
  const speech = useSpeech();
  const chat = useAgentChat("analytics");
  const { pins, pin, unpin, isPinned } = usePins();
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const status: OrbState = listening ? "listening" : chat.sending ? "thinking" : speech.speaking ? "speaking" : "idle";

  const ask = (question: string) => void chat.send(question);

  const tell = (result: "added" | "exists" | "full") =>
    setNotice(result === "added" ? "Pinned to the board." : result === "exists" ? "Already on the board." : "The board is full — unpin something first.");

  const pinChart = (spec: ChartSpec) =>
    tell(pin({ id: pinId("chart", JSON.stringify(spec)), kind: "chart", title: spec.title, chart: spec }));

  const chartExtra = (spec: ChartSpec) => {
    const pinned = isPinned(pinId("chart", JSON.stringify(spec)));
    return (
      <div className="ws-chart-actions">
        <Button size="small" variant="outlined" disabled={chat.sending} onClick={() => ask(explainChartPrompt(spec))} sx={{ minHeight: 40 }}>
          Explain this chart
        </Button>
        <Button size="small" variant="outlined" startIcon={<PushPinOutlinedIcon fontSize="small" />} disabled={pinned} onClick={() => pinChart(spec)} sx={{ minHeight: 40 }}>
          {pinned ? "Pinned" : "Pin"}
        </Button>
        {spec.categories.length > 1 && (
          <div className="ws-drill" role="group" aria-label="Drill down">
            <span className="ws-drill-label">Drill into</span>
            {spec.categories.slice(0, DRILL_CHIPS).map((c) => (
              <Chip key={c} label={c} size="small" variant="outlined" clickable disabled={chat.sending} onClick={() => ask(drillPrompt(spec, c))} sx={{ height: 32 }} />
            ))}
          </div>
        )}
      </div>
    );
  };

  const messageExtra = ({ text }: { id: string; text: string }) => {
    const plain = text.replace(CHART_MARKER, "").trim();
    // A chart is pinned as a chart; only pin written answers that carry no chart.
    if (!plain || text.includes("```asc-chart")) return null;
    const id = pinId("answer", plain);
    return (
      <Chip
        size="small"
        variant="outlined"
        clickable
        disabled={isPinned(id)}
        icon={<PushPinOutlinedIcon sx={{ fontSize: 14 }} />}
        label={isPinned(id) ? "Pinned" : "Pin"}
        onClick={() => tell(pin({ id, kind: "answer", title: answerTitle(plain), text: plain.slice(0, 600) }))}
        sx={{ height: 24, fontSize: 11 }}
      />
    );
  };

  return (
    <WorkspaceShell
      agent="analytics"
      status={status}
      actions={
        <>
          <ProviderSelect chat={chat} />
          <Tooltip title="New chat">
            <IconButton size="small" onClick={() => { speech.cancel(); chat.reset(); }} aria-label="New chat">
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" component={Link} href="/assistant/classic?agent=analytics" sx={{ minHeight: 36 }}>
            History &amp; classic chat
          </Button>
        </>
      }
    >
      <div className="ws-analytics">
        <ChatPanel
          chat={chat}
          speech={speech}
          prompts={PROMPTS}
          emptyTitle="What do you want to analyse?"
          placeholder="Ask the Analytics agent — brokers, grades, marks, trends over 13 years"
          onListeningChange={setListening}
          chartExtra={chartExtra}
          messageExtra={messageExtra}
        />
        <div className="ws-side">
          <CompareBuilder busy={chat.sending} onAsk={ask} />
          <PinnedBoard pins={pins} onUnpin={unpin} onAsk={ask} busy={chat.sending} />
          <p className="ws-lots-note" role="status" aria-live="polite">{notice}</p>
        </div>
      </div>
    </WorkspaceShell>
  );
}
