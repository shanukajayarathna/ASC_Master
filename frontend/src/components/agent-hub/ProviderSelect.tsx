"use client";

import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import type { useAgentChat } from "./useAgentChat";

/** The AI provider picker shared by every workspace header. Unconfigured providers are listed but disabled. */
export default function ProviderSelect({ chat }: { chat: ReturnType<typeof useAgentChat> }) {
  const options = chat.providers.length > 0 ? chat.providers : [{ key: "local", displayName: "Local", model: null, configured: true }];
  return (
    <Select
      size="small"
      value={chat.provider}
      onChange={(e) => chat.setProvider(e.target.value)}
      sx={{ minWidth: 120, fontSize: 13 }}
      inputProps={{ "aria-label": "AI provider" }}
    >
      {options.map((p) => (
        <MenuItem key={p.key} value={p.key} disabled={!p.configured}>
          {p.displayName}
          {!p.configured && " (not configured)"}
        </MenuItem>
      ))}
    </Select>
  );
}
