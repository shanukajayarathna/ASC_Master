"use client";

import AddCommentOutlinedIcon from "@mui/icons-material/AddCommentOutlined";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useState } from "react";
import ChatPanel from "./ChatPanel";
import LotLookup from "./LotLookup";
import ProviderSelect from "./ProviderSelect";
import { useAgentChat } from "./useAgentChat";
import type { OrbState } from "./VoiceOrb";
import { useSpeech } from "./voice";
import WorkspaceShell from "./WorkspaceShell";

const PROMPTS = ["Show me the top prices", "Which gardens fetched the highest prices?", "Compare the last two sales", "Who were the top buyers?"];

/**
 * The Auction workspace: find a lot in the active sale, then ask the Auction agent to explain its valuation
 * or compare its price with its grade and broker — or just chat. The agent's tools are read-only, as ever.
 */
export default function AuctionWorkspace() {
  const speech = useSpeech();
  const chat = useAgentChat("auction");
  const [listening, setListening] = useState(false);
  const status: OrbState = listening ? "listening" : chat.sending ? "thinking" : speech.speaking ? "speaking" : "idle";

  return (
    <WorkspaceShell
      agent="auction"
      status={status}
      actions={
        <>
          <ProviderSelect chat={chat} />
          <Tooltip title="New chat">
            <IconButton size="small" onClick={() => { speech.cancel(); chat.reset(); }} aria-label="New chat">
              <AddCommentOutlinedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Button size="small" variant="outlined" component={Link} href="/assistant/classic?agent=auction" sx={{ minHeight: 36 }}>
            History &amp; classic chat
          </Button>
        </>
      }
    >
      <div className="ws-auction">
        <LotLookup busy={chat.sending} onAsk={(q) => void chat.send(q)} />
        <ChatPanel
          chat={chat}
          speech={speech}
          prompts={PROMPTS}
          emptyTitle="Ask about this sale"
          placeholder="Ask the Auction agent — lots, valuations, prices, buyers"
          onListeningChange={setListening}
        />
      </div>
    </WorkspaceShell>
  );
}
