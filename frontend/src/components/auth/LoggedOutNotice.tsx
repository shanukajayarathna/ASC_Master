"use client";

import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import { useState } from "react";

/** Shown by useForceLogoutOnPublicPage's callers once it's actually ended a live session —
 *  explains why the form is sitting there empty instead of silently skipping straight back
 *  into the app. Dismissible; not auto-hiding, since missing why you're suddenly signed out
 *  is worse than a banner staying a few extra seconds. */
export default function LoggedOutNotice() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;

  return (
    <div
      role="status"
      className="w-full max-w-[380px] mx-auto mb-5 flex items-start gap-2.5 px-3.5 py-3 rounded-[var(--radius-lg)] border"
      style={{ background: "var(--warn-light)", borderColor: "var(--warn)" }}
    >
      <InfoOutlinedIcon sx={{ fontSize: 18, color: "var(--warn)", flexShrink: 0, marginTop: "1px" }} />
      <p className="text-[12.5px] leading-snug m-0 flex-1" style={{ color: "var(--text-strong)" }}>
        You&rsquo;ve been signed out because you left your session. Sign in again to continue.
      </p>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss"
        className="text-[16px] leading-none shrink-0 cursor-pointer bg-transparent border-0 p-0"
        style={{ color: "var(--text-muted)" }}
      >
        ×
      </button>
    </div>
  );
}
