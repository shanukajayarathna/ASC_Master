"use client";

import { RichText } from "@/components/assistant/RichText";
import { api } from "@/lib/api";
import Button from "@mui/material/Button";
import Link from "next/link";
import { useState } from "react";
import ProviderSelect from "./ProviderSelect";
import ReportBuilderPanel from "./ReportBuilderPanel";
import ReportOutputs from "./ReportOutputs";
import ReportPreview from "./ReportPreview";
import { DEFAULT_STATE, toRequest, type BuilderState } from "./reportBuilder";
import { applyVoiceCommand } from "./voiceCommand";
import { useAgentChat } from "./useAgentChat";
import { useReportPreview } from "./useReportPreview";
import type { OrbState } from "./VoiceOrb";
import WorkspaceShell from "./WorkspaceShell";

/**
 * The Reports workspace: a builder on the left, a live paper-style preview in the centre (figures straight
 * from the archive), and outputs on the right. "Build from description" hands a free-text request to the Reports
 * agent, whose answer (with its own charts) appears under the preview and can be saved as a report too.
 */
export default function ReportsWorkspace() {
  const [state, setState] = useState<BuilderState>(DEFAULT_STATE);
  const { preview, loading, error } = useReportPreview(state);
  const chat = useAgentChat("reports");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const lastAnswer = [...chat.messages].reverse().find((m) => m.role === "assistant") ?? null;
  const status: OrbState = chat.sending ? "thinking" : "idle";

  const describe = (text: string) => {
    setSaveState("idle");
    void chat.send(`Build this report from the archive: ${text}. State the scope you used, then show a table and a chart.`);
  };

  const saveAnswer = async () => {
    if (!lastAnswer) return;
    setSaveState("saving");
    try {
      const first = lastAnswer.content.match(/```asc-chart\n[\s\S]*?"title":"([^"]+)"/)?.[1];
      await api.saveCustomReport(first ?? "Custom report", lastAnswer.content);
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  };

  return (
    <WorkspaceShell
      agent="reports"
      status={status}
      actions={
        <>
          <ProviderSelect chat={chat} />
          <Button size="small" variant="outlined" component={Link} href="/saved-reports" sx={{ minHeight: 36 }}>
            Saved Reports
          </Button>
          <Button size="small" variant="outlined" component={Link} href="/assistant/classic?agent=reports" sx={{ minHeight: 36 }}>
            History &amp; classic chat
          </Button>
        </>
      }
    >
      <div className="ws-reports">
        <ReportBuilderPanel state={state} onChange={setState} onDescribe={describe} describing={chat.sending} />

        <div className="ws-center">
          <ReportPreview preview={preview} loading={loading} error={error} visual={state.visual} />

          {(chat.sending || lastAnswer || chat.error) && (
            <section className="ws-agent-answer" aria-label="Reports agent answer">
              <h2 className="ws-lots-title">From the Reports agent</h2>
              {chat.sending && <p className="ws-lots-note" role="status">Building your report…</p>}
              {chat.error && <p className="ws-lots-note ws-lots-error" role="alert">{chat.error}</p>}
              {lastAnswer && !chat.sending && (
                <>
                  <div className="ws-agent-body">
                    <RichText text={lastAnswer.content} />
                  </div>
                  <div className="ws-chart-actions">
                    <Button size="small" variant="outlined" disabled={saveState === "saving" || saveState === "saved"} onClick={saveAnswer} sx={{ minHeight: 40 }}>
                      {saveState === "saved" ? "Saved" : saveState === "saving" ? "Saving…" : "Save this answer as a report"}
                    </Button>
                    {saveState === "error" && <span className="ws-lots-error">Couldn&apos;t save — try again.</span>}
                  </div>
                </>
              )}
            </section>
          )}
        </div>

        <ReportOutputs preview={preview} visual={state.visual} request={toRequest(state)} onVoiceApply={(cmd) => setState((s) => applyVoiceCommand(s, cmd))} />
      </div>
    </WorkspaceShell>
  );
}
