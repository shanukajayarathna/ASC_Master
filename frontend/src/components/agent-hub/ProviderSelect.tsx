"use client";

import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import type { useAgentChat } from "./useAgentChat";

/** The AI provider picker shared by every workspace header. Unconfigured providers are listed but disabled. */
export default function ProviderSelect({ chat }: { chat: ReturnType<typeof useAgentChat> }) {
  const options = chat.providers.length > 0 ? chat.providers : [{ key: chat.provider, displayName: chat.providersReady ? "Provider status unavailable" : "Loading providers…", model: null, configured: false }];
  return (
    <Select
      size="small"
      value={chat.provider}
      renderValue={(value) => {
        const selected = chat.providers.find((p) => p.key === value);
        return selected ? `${selected.displayName}${selected.model ? ` · ${selected.model}` : ""}` : options[0].displayName;
      }}
      onChange={(e) => chat.setProvider(e.target.value)}
      sx={{ minWidth: 120, fontSize: 13 }}
      inputProps={{ "aria-label": "AI provider" }}
      disabled={!chat.providersReady}
    >
      {options.map((p) => (
        <MenuItem key={p.key} value={p.key} disabled={!p.configured}>
          {p.displayName}{p.model ? ` · ${p.model}` : ""}
          {!p.configured && " (not configured)"}
        </MenuItem>
      ))}
    </Select>
  );
}
