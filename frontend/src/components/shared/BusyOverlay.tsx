"use client";

import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useThemeMode } from "@/context/ThemeModeContext";
import { useEffect, useRef } from "react";

/**
 * Full-screen branded busy overlay for LONG in-page operations — catalogue imports,
 * Excel/PDF exports, report generation. Renders the same identity as route transitions
 * (NavigationLoader): brand mark, TeaLoader, a status line, over the same frosted veil
 * (`--overlay-veil` + backdrop blur), so the page stays faintly visible underneath while
 * being unreadable and unclickable. Blocks all clicks while mounted and pulls keyboard
 * focus onto itself, so a slow export can't be triggered three times by someone
 * re-clicking a button that looks idle. Mount it conditionally:
 * `{busy && <BusyOverlay message="Exporting…" />}`.
 *
 * Quick actions (a sub-second save) should keep their button busy-state instead — see
 * docs/28's decision rules; this overlay is for operations long enough that the user
 * might otherwise doubt the click registered.
 *
 * The veil lives on a dedicated child layer, NOT as a background on this element itself —
 * a translucent background on the element containing FullScreenLoader's logo <img>
 * reproducibly failed to paint in Chromium (see NavigationLoader's doc comment for the
 * full history); the separate `backdrop-filter` layer sidesteps that and was re-verified
 * painting correctly.
 */
export default function BusyOverlay({ message }: { message: string }) {
  const { mode } = useThemeMode();
  const ref = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    // Take focus while the overlay is up; hand it back to the triggering control after,
    // so a keyboard user isn't dumped back at the top of the page.
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    ref.current?.focus();
    return () => restoreRef.current?.focus();
  }, []);

  return (
    <div
      ref={ref}
      role="status"
      aria-live="polite"
      tabIndex={-1}
      className="fixed inset-0 z-[9999] flex flex-col items-center justify-center outline-none"
    >
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background: "var(--overlay-veil)",
          backdropFilter: "blur(14px) saturate(1.1)",
          WebkitBackdropFilter: "blur(14px) saturate(1.1)",
        }}
      />
      {/* Positioned so it paints above the veil. */}
      <div className="relative">
        <FullScreenLoader message={message} onDark={mode === "dark"} />
      </div>
    </div>
  );
}
