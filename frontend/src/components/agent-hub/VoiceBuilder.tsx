"use client";

import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState, type KeyboardEvent, type PointerEvent } from "react";
import VoiceOrb from "./VoiceOrb";
import { SAMPLE_LINE, parseVoiceCommand, type VoiceCommand } from "./voiceCommand";
import { useHoldToSpeak, useMicLevel } from "./voice";

interface VoiceBuilderProps {
  /** Applies the understood request to the builder (the preview then re-queries the archive). */
  onApply: (command: VoiceCommand) => void;
}

/**
 * Build a report by speaking: hold the button, say what you want, and the words appear for review — nothing runs
 * until "Apply". Applying only sets the builder's controls (by plain keyword rules, so the result is predictable
 * and shown to you in words), and the figures still come from the archive, never from the words you spoke.
 */
export default function VoiceBuilder({ onApply }: VoiceBuilderProps) {
  const [text, setText] = useState("");
  const [result, setResult] = useState<VoiceCommand | null>(null);
  const speech = useHoldToSpeak((spoken) => {
    setText((prev) => (prev.trim() ? `${prev.trim()} ${spoken}` : spoken));
    setResult(null);
  });
  const level = useMicLevel(speech.listening);

  const apply = () => {
    const command = parseVoiceCommand(text);
    setResult(command);
    if (Object.keys(command.patch).length > 0) onApply(command);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    if ((e.key === " " || e.key === "Enter") && !e.repeat) {
      e.preventDefault();
      speech.start();
    }
  };
  const onKeyUp = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === " " || e.key === "Enter") speech.stop();
  };
  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture?.(e.pointerId);
    speech.start();
  };

  const recognised = result && Object.keys(result.patch).length > 0;

  return (
    <section className="ws-out ws-voicebuilder" aria-label="Voice builder">
      <h3 className="ws-out-title">Voice builder</h3>
      <div className="ws-vb-top">
        <VoiceOrb state={speech.listening ? "listening" : "idle"} getLevel={level} />
        <button
          type="button"
          className="ws-hold"
          aria-pressed={speech.listening}
          disabled={!speech.supported}
          onPointerDown={onPointerDown}
          onPointerUp={speech.stop}
          onPointerCancel={speech.stop}
          onKeyDown={onKeyDown}
          onKeyUp={onKeyUp}
          onBlur={speech.stop}
        >
          {speech.listening ? "Listening… release to finish" : "Hold to speak"}
        </button>
      </div>

      {!speech.supported && <p className="ws-lots-note">Voice input isn&apos;t supported in this browser (Chrome or Edge work) — you can type the request instead.</p>}
      {speech.error && <p className="ws-lots-note ws-lots-error" role="alert">{speech.error}</p>}

      <p className="ws-lots-note">
        Try: <button type="button" className="ws-sample" onClick={() => { setText(SAMPLE_LINE); setResult(null); }}>“{SAMPLE_LINE}”</button>
      </p>

      <TextField
        value={text}
        onChange={(e) => { setText(e.target.value); setResult(null); }}
        label="What you said"
        size="small"
        multiline
        minRows={2}
        maxRows={4}
        fullWidth
        slotProps={{ htmlInput: { maxLength: 500 } }}
      />
      <Button variant="contained" disabled={!text.trim()} onClick={apply} sx={{ minHeight: 44 }}>
        Apply to builder
      </Button>

      {result && (
        <div className="ws-vb-result" role="status" aria-live="polite">
          {recognised ? (
            <>
              <strong>Understood</strong>
              <ul>
                {result.understood.map((u) => (
                  <li key={u}>{u}</li>
                ))}
              </ul>
            </>
          ) : (
            <p>I didn&apos;t recognise a report request. Name what to compare (brokers, grades, sales), the period (last 4 or 12 sales, this year) and, if you like, the measure.</p>
          )}
          {result.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
          {result.wantsDeck && recognised && <p>To make the deck, use <em>Generate PowerPoint</em> below once the report looks right.</p>}
        </div>
      )}
      <p className="ws-lots-note">Voice commands are understood in English.</p>
    </section>
  );
}
