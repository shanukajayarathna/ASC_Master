"use client";

import CloseIcon from "@mui/icons-material/Close";
import Drawer from "@mui/material/Drawer";
import IconButton from "@mui/material/IconButton";
import { useEffect, useState } from "react";
import ReportBuilderPanel from "./ReportBuilderPanel";
import ReportOutputs from "./ReportOutputs";
import ReportPreview from "./ReportPreview";
import { toRequest, type BuilderState } from "./reportBuilder";
import { useReportPreview } from "./useReportPreview";
import "./workspace.css";

interface ReportCanvasProps {
  open: boolean;
  /** The builder settings the canvas opens with (read from the request in the chat). */
  initial: BuilderState;
  onClose: () => void;
}

/**
 * The report canvas: the one place that needs room. It slides in beside the chat when a request should become a
 * report you can adjust — builder, live preview (figures straight from the archive) and outputs (Excel, PDF, snapshot,
 * PowerPoint, schedule). Closing it leaves the conversation exactly as it was.
 */
export default function ReportCanvas({ open, initial, onClose }: ReportCanvasProps) {
  return (
    <Drawer anchor="right" open={open} onClose={onClose} slotProps={{ paper: { sx: { width: "min(100vw, 1120px)" }, "aria-label": "Report canvas" } }}>
      {open && <CanvasBody initial={initial} onClose={onClose} />}
    </Drawer>
  );
}

function CanvasBody({ initial, onClose }: { initial: BuilderState; onClose: () => void }) {
  const [state, setState] = useState<BuilderState>(initial);
  // Opening the canvas for a different request starts from that request.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-seed when a different request opens the canvas
    setState(initial);
  }, [initial]);
  const { preview, loading, error } = useReportPreview(state);

  return (
    <div className="ws-canvas workspace" data-agent="reports">
      <header className="ws-canvas-head">
        <h2 className="ws-canvas-title">Report canvas</h2>
        <IconButton onClick={onClose} aria-label="Close the report canvas" sx={{ width: 44, height: 44 }}>
          <CloseIcon />
        </IconButton>
      </header>
      <div className="ws-reports ws-canvas-body">
        <ReportBuilderPanel state={state} onChange={setState} />
        <div className="ws-center">
          <ReportPreview preview={preview} loading={loading} error={error} visual={state.visual} />
        </div>
        <ReportOutputs preview={preview} visual={state.visual} request={toRequest(state)} />
      </div>
    </div>
  );
}
