"use client";

import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import Switch from "@mui/material/Switch";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import ChatPanel from "./ChatPanel";
import ProviderSelect from "./ProviderSelect";
import { useAgentChat } from "./useAgentChat";
import { useReducedMotion } from "./useHubEnv";
import VoiceOrb, { ORB_COPY, ORB_STATES, type OrbState } from "./VoiceOrb";
import { useMicLevel, useSpeech } from "./voice";
import WorkspaceShell from "./WorkspaceShell";

const PROMPTS = ["Summarise this week's sale", "Explain a valuation", "Find a by-law", "Which agent should I use?"];
/** The state switcher under the orb is for design review only — never shown in a production build. */
const SHOW_DEMO = process.env.NODE_ENV !== "production";

/**
 * The General workspace: the chat on the left (with the read-aloud chip on each answer and suggested
 * prompts) and a large voice panel on the right. Speech in is the existing mic (transcript lands in the
 * box for review, never auto-sent); speech out is the browser's speech synthesis.
 */
export default function GeneralWorkspace() {
  const reduced = useReducedMotion();
  const speech = useSpeech();
  const [voiceReplies, setVoiceReplies] = useState(false);
  const voiceRepliesRef = useRef(false);
  useEffect(() => {
    voiceRepliesRef.current = voiceReplies;
  });
  const chat = useAgentChat("general", {
    onReply: (text) => {
      if (voiceRepliesRef.current) speech.speak(text);
    },
  });

  const [listening, setListening] = useState(false);
  const [demoState, setDemoState] = useState<OrbState | null>(null);

  const micLevel = useMicLevel(listening);
  const liveState: OrbState = listening ? "listening" : chat.sending ? "thinking" : speech.speaking ? "speaking" : "idle";
  const orbState = demoState ?? liveState;
  const getLevel = orbState === "listening" ? micLevel : speech.getLevel;
  const copy = ORB_COPY[orbState];

  return (
    <WorkspaceShell
      agent="general"
      status={orbState}
      actions={
        <>
          <ProviderSelect chat={chat} />
          <Tooltip title="New chat">
            <IconButton
              size="small"
              onClick={() => {
                speech.cancel();
                chat.reset();
              }}
              aria-label="New chat"
            >
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" component={Link} href="/assistant/classic" sx={{ minHeight: 36 }}>
            History &amp; classic chat
          </Button>
        </>
      }
    >
      <div className="ws-general">
        <ChatPanel
          chat={chat}
          speech={speech}
          prompts={PROMPTS}
          emptyTitle="What would you like to know?"
          placeholder="Ask anything — English, සිංහල, தமிழ், or Singlish"
          onListeningChange={setListening}
        />

        <aside className="ws-voice" aria-label="Voice">
          <VoiceOrb state={orbState} getLevel={getLevel} reduced={reduced} />
          <div>
            <h2 className="ws-voice-title">{copy.title}</h2>
            <p className="ws-voice-hint" aria-live="polite">{copy.hint}</p>
          </div>
          {speech.speaking && (
            <Button size="small" variant="outlined" startIcon={<StopCircleOutlinedIcon />} onClick={speech.cancel} sx={{ minHeight: 44 }}>
              Stop speaking
            </Button>
          )}
          {speech.supported ? (
            <FormControlLabel
              control={<Switch checked={voiceReplies} onChange={(e) => setVoiceReplies(e.target.checked)} />}
              label="Read replies aloud"
              sx={{ "& .MuiFormControlLabel-label": { fontSize: 13 } }}
            />
          ) : (
            <p className="ws-voice-hint">Reading aloud isn&apos;t supported in this browser.</p>
          )}
          {speech.missingVoice && (
            <p className="ws-voice-note" role="status">
              No installed voice for {speech.missingVoice} — the answer may not be spoken. Try English, or add a voice in your system settings.
            </p>
          )}
          {SHOW_DEMO && (
            <div className="ws-demo" role="group" aria-label="Orb state (design review only)">
              {[null, ...ORB_STATES].map((s) => (
                <Chip key={s ?? "live"} size="small" label={s ?? "live"} variant={demoState === s ? "filled" : "outlined"} clickable onClick={() => setDemoState(s)} />
              ))}
            </div>
          )}
        </aside>
      </div>
    </WorkspaceShell>
  );
}
