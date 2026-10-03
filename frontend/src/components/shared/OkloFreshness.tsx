"use client";

import { api } from "@/lib/api";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useState } from "react";

function timeAgo(iso: string): string {
  const minutes = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 60_000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Shows the API's real OKLO freshness stamp wherever sale selection is available. */
export default function OkloFreshness({ className = "" }: { className?: string }) {
  const [checkedUtc, setCheckedUtc] = useState<string | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const load = () => api.getOkloFreshness().then((f) => {
      setEnabled(f.enabled);
      setCheckedUtc(f.newestCheckedUtc);
    }).catch(() => {});
    load();
    const poll = setInterval(load, 30_000);
    const rerender = setInterval(() => tick((n) => n + 1), 30_000);
    return () => { clearInterval(poll); clearInterval(rerender); };
  }, []);

  if (!enabled) return null;
  const iso = checkedUtc && !/[zZ]|[+-]\d\d:\d\d$/.test(checkedUtc) ? `${checkedUtc}Z` : checkedUtc;
  return <Tooltip title="Sale data is pulled live from OKLO SmartAuction and refreshed while you use the system.">
    <span className={className} role="status" aria-live="polite">
      {iso ? `OKLO data · updated ${timeAgo(iso)}` : "OKLO data · syncing…"}
    </span>
  </Tooltip>;
}
