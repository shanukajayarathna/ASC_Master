"use client";

import Chip from "@mui/material/Chip";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import { useState } from "react";
import { AGENT_KEYS, AGENT_LABEL, isAgentKey, type AgentKey } from "./agents";

export const agentLabel = (key: string | null | undefined) => (isAgentKey(key) ? AGENT_LABEL[key] : null);

interface AgentTagProps {
  agent: string;
  /** Asks the same question again with a different specialist. */
  onReask: (agent: AgentKey) => void;
  disabled?: boolean;
}

/**
 * A small label on an answer saying which specialist wrote it. Nobody has to choose an agent up front, but if the
 * automatic pick was wrong the tag lets you ask the same question again with another one.
 */
export default function AgentTag({ agent, onReask, disabled }: AgentTagProps) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const label = agentLabel(agent);
  if (!label) return null;

  return (
    <>
      <Chip
        size="small"
        variant="outlined"
        clickable
        disabled={disabled}
        label={`Answered by ${label}`}
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ height: 24, fontSize: 11 }}
      />
      <Menu anchorEl={anchor} open={anchor !== null} onClose={() => setAnchor(null)}>
        {AGENT_KEYS.filter((k) => k !== agent).map((k) => (
          <MenuItem
            key={k}
            onClick={() => {
              setAnchor(null);
              onReask(k);
            }}
            sx={{ minHeight: 44 }}
          >
            Ask {AGENT_LABEL[k]} instead
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}
