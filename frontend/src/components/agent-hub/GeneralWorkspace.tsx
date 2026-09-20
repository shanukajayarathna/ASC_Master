"use client";

import MicButton from "@/components/assistant/MicButton";
import { parseClarify, RichText } from "@/components/assistant/RichText";
import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import StopCircleOutlinedIcon from "@mui/icons-material/StopCircleOutlined";
import VolumeUpOutlinedIcon from "@mui/icons-material/VolumeUpOutlined";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAgentChat } from "./useAgentChat";
import { useReducedMotion } from "./useHubEnv";
import VoiceOrb, { ORB_COPY, ORB_STATES, type OrbState } from "./VoiceOrb";
import { useMicLevel, useSpeech } from "./voice";
import WorkspaceShell from "./WorkspaceShell";

const MAX_MESSAGE_LENGTH = 8000;
const PROMPTS = ["Summarise this week's sale", "Explain a valuation", "Find a by-law", "Which agent should I use?"];
/** The state switcher under the orb is for design review only — never shown in a production build. */
const SHOW_DEMO = process.env.NODE_ENV !== "production";

const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

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

  const [input, setInput] = useState("");
  const [listening, setListening] = useState(false);
  const [demoState, setDemoState] = useState<OrbState | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const micLevel = useMicLevel(listening);
  const liveState: OrbState = listening ? "listening" : chat.sending ? "thinking" : speech.speaking ? "speaking" : "idle";
  const orbState = demoState ?? liveState;
  const getLevel = orbState === "listening" ? micLevel : speech.getLevel;

  useEffect(() => {
    // Scroll only the conversation card (never the page) and only once there is something to follow.
    const el = scrollRef.current;
    if (el && (chat.messages.length > 0 || chat.sending)) el.scrollTo({ top: el.scrollHeight, behavior: reduced ? "auto" : "smooth" });
  }, [chat.messages, chat.sending, reduced]);

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
  const copy_ = ORB_COPY[orbState];

  return (
    <WorkspaceShell
      agent="general"
      status={orbState}
      actions={
        <>
          <Select
            size="small"
            value={chat.provider}
            onChange={(e) => chat.setProvider(e.target.value)}
            sx={{ minWidth: 120, fontSize: 13 }}
            inputProps={{ "aria-label": "AI provider" }}
          >
            {(chat.providers.length > 0 ? chat.providers : [{ key: "local", displayName: "Local", model: null, configured: true }]).map((p) => (
              <MenuItem key={p.key} value={p.key} disabled={!p.configured}>
                {p.displayName}
                {!p.configured && " (not configured)"}
              </MenuItem>
            ))}
          </Select>
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
        <section className="min-w-0 min-h-0 flex flex-col" aria-label="Conversation">
          <div ref={scrollRef} className="flex-1 min-h-0 overflow-y-auto border border-border rounded-[var(--radius-lg)] bg-surface p-4 flex flex-col gap-4">
            {isEmpty && !chat.sending && (
              <div className="flex flex-col items-center gap-3 my-auto py-2 text-center">
                <h2 className="font-display text-[22px] font-semibold m-0 text-text-strong">What would you like to know?</h2>
                <div className="flex flex-wrap justify-center gap-2">
                  {PROMPTS.map((p) => (
                    <Chip key={p} label={p} variant="outlined" clickable onClick={() => submit(p)} sx={{ height: 40 }} />
                  ))}
                </div>
              </div>
            )}

            <div role="log" aria-live="polite" className="flex flex-col gap-4">
              {chat.messages.map((m, i) => {
                const isUser = m.role === "user";
                const { text, clarify } = isUser ? { text: m.content, clarify: undefined } : parseClarify(m.content);
                const hasChart = !isUser && text.includes("```asc-chart");
                return (
                  <div key={m.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"} gap-1`}>
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
                            <Chip key={opt} label={opt} size="small" variant="outlined" clickable disabled={chat.sending || i !== lastAssistantIdx} onClick={() => submit(opt)} />
                          ))}
                        </div>
                      </div>
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
                    </div>
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
                    {chat.slow ? "Still working — local models can take a few minutes." : "Thinking…"}
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
              onListeningChange={setListening}
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
              placeholder="Ask anything — English, සිංහල, தமிழ், or Singlish"
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

        <aside className="ws-voice" aria-label="Voice">
          <VoiceOrb state={orbState} getLevel={getLevel} reduced={reduced} />
          <div>
            <h2 className="ws-voice-title">{copy_.title}</h2>
            <p className="ws-voice-hint" aria-live="polite">{copy_.hint}</p>
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
