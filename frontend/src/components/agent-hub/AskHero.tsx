"use client";

import MicButton from "@/components/assistant/MicButton";
import type { UiStrings } from "@/lib/i18n";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import TextField from "@mui/material/TextField";
import { useRouter } from "next/navigation";
import { useId, useRef, useState, type FormEvent } from "react";
import { askHref } from "./agents";
import { useInView } from "./useHubEnv";
import { GeneralVisual } from "./visuals";

/** Matches the chat's own limit (AssistantController's MaxMessageLength). */
const MAX_LENGTH = 8000;

/**
 * The hub's primary action: just ask. This is the General assistant, so a user never has to know which
 * agent to pick — they type (or speak) a question and it is sent straight to the chat. The specialists
 * below are for people who already know they want one specific job done.
 */
export default function AskHero({ t, reduced }: { t: UiStrings; reduced: boolean }) {
  const router = useRouter();
  const titleId = useId();
  const [text, setText] = useState("");
  const artRef = useRef<HTMLDivElement>(null);
  const inView = useInView(artRef, 0.05);

  const ask = (question: string) => {
    const q = question.trim();
    if (q) router.push(askHref(q));
  };
  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    ask(text);
  };

  const prompts = [t.hubPrompt1, t.hubPrompt2, t.hubPrompt3];

  return (
    <section className="hub-ask" data-agent="general" aria-labelledby={titleId}>
      <div ref={artRef} className="hub-art">
        <span className="hub-glare" aria-hidden="true" />
        <div className="hub-top">
          <div className="hub-label">
            <span className="hub-dot" aria-hidden="true" />
            {`${t.hubAgentLabel(1)} · ${t.hubStartHere}`}
          </div>
        </div>
        <div className="hub-visual">
          <GeneralVisual run={inView && !reduced} frozen={reduced} />
        </div>
      </div>

      <div className="hub-ask-body">
        <h2 id={titleId} className="hub-heading">{t.hubAskTitle}</h2>
        <p className="hub-ask-hint">{t.hubAskHint}</p>

        <form className="hub-ask-form" onSubmit={onSubmit}>
          <TextField
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t.hubAskPlaceholder}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { "aria-label": t.hubAskLabel, maxLength: MAX_LENGTH, enterKeyHint: "send" } }}
            sx={{ "& .MuiInputBase-root": { minHeight: 48, borderRadius: 24 } }}
          />
          {/* Voice input: the transcript lands in the box for review — never auto-sent. */}
          <MicButton large onTranscript={(spoken) => setText((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken))} />
          <Button type="submit" variant="contained" disabled={!text.trim()} sx={{ minHeight: 48, minWidth: 84, borderRadius: 24 }}>
            {t.hubAskSend}
          </Button>
        </form>

        <div className="hub-ask-chips">
          {prompts.map((p) => (
            <Chip key={p} label={p} variant="outlined" clickable onClick={() => ask(p)} sx={{ height: 44, borderRadius: 22 }} />
          ))}
        </div>
      </div>
    </section>
  );
}
