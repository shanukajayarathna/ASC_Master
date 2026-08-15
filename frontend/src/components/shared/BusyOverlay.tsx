"use client";

import FullScreenLoader from "@/components/shared/FullScreenLoader";
import { useEffect, useRef } from "react";

/**
 * Full-screen branded busy overlay for LONG in-page operations — catalogue imports,
 * Excel/PDF exports, report generation. Renders the same identity as route transitions
 * (NavigationLoader): brand mark, the filling-leaf TeaLoader, a status line, on the fixed
 * dark ground. Blocks all clicks while mounted and pulls keyboard focus onto itself, so a
 * slow export can't be triggered three times by someone re-clicking a button that looks
 * idle. Mount it conditionally: `{busy && <BusyOverlay message="Exporting…" />}`.
 *
 * Quick actions (a sub-second save) should keep their button busy-state instead — see
 * docs/28's decision rules; this overlay is for operations long enough that the user
 * might otherwise doubt the click registered.
 *
 * Opaque background on purpose — same Chromium paint bug NavigationLoader documents:
 * a translucent background here reproducibly fails to paint when the logo <img> is in
 * the tree.
 */
export default function BusyOverlay({ message }: { message: string }) {
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
      style={{ background: "var(--ink-solid-900)" }}
    >
      <FullScreenLoader message={message} onDark />
    </div>
  );
}
