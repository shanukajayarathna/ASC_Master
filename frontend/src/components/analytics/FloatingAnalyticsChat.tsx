"use client";

import AnalyticsChat from "@/components/analytics/AnalyticsChat";
import TeaLoader from "@/components/shared/TeaLoader";
import type { MslAnalyticsFilter } from "@/types/api";
import { useState } from "react";

/**
 * The Analytics Agent as a floating dock: fixed to the bottom-right so it stays on screen
 * however far the Analysis page scrolls. The collapsed pill carries the platform's own
 * brand mark — the brewing glass-cup animation used at boot and login (TeaLoader), steam
 * rising continuously — over a soft gold underglow. The chat stays MOUNTED while
 * collapsed, so the conversation and its filter context survive open/close.
 */
export default function FloatingAnalyticsChat({ filter }: { filter: MslAnalyticsFilter }) {
  // Starts CLOSED: the pill glows (and wiggles once) until the user opens it.
  const [open, setOpen] = useState(false);
  const [noticed, setNoticed] = useState(false);

  return (
    <>
      <div
        className={`fixed bottom-4 right-4 z-40 w-[370px] max-w-[calc(100vw-2rem)] shadow-2xl rounded-md transition-all duration-200 origin-bottom-right ${
          open ? "opacity-100 scale-100" : "opacity-0 scale-90 pointer-events-none"
        }`}
      >
        <AnalyticsChat filter={filter} onClose={() => setOpen(false)} />
      </div>

      {!open && (
        <div className="fixed bottom-4 right-4 z-40">
          {/* A restrained gold pool under the pill — warmth, not spectacle. */}
          <div
            aria-hidden
            className="absolute inset-x-2 -bottom-1.5 h-5 rounded-[50%] agent-underglow pointer-events-none"
            style={{
              background:
                "radial-gradient(closest-side, color-mix(in srgb, var(--brand-gold) 40%, transparent), transparent 78%)",
              filter: "blur(7px)",
            }}
          />
          <button
            onClick={() => {
              setOpen(true);
              setNoticed(true);
            }}
            className={`relative flex items-center gap-2 rounded-full border border-brass bg-surface pl-2 pr-4 py-1.5 shadow-xl hover:bg-[color-mix(in_srgb,var(--brand-gold)_14%,var(--paper-0))] ${noticed ? "" : "agent-attention"}`}
            aria-label="Open Analytics Agent chat"
          >
            {/* The brand's brewing cup — same mark as the app's loaders, steam always rising. */}
            <TeaLoader size={30} />
            <span className="flex flex-col items-start leading-tight text-left">
              <span className="font-display text-[13px] font-semibold text-text-strong">Analytics Agent</span>
              <span className="text-[10px] text-text-muted">Ask about this slice</span>
            </span>
          </button>
        </div>
      )}
    </>
  );
}
