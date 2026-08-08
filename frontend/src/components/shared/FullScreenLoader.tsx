import BrandLogo from "@/components/shell/BrandLogo";
import TeaLoader from "@/components/shared/TeaLoader";

/**
 * The full identity for the app's handful of genuinely full-screen, interaction-blocking
 * loading moments — application boot/auth restoration (app/(app)/layout.tsx), the login
 * page's pre-auth-check, and route transitions (NavigationLoader). Not used for anything
 * smaller than that (a page's own data loading uses a skeleton; a button's own request uses
 * its own busy label) — see docs/28_Loading_And_Interaction_States.md for the full decision
 * rule. Brand mark, then the leaf/data-flow animation, then a status line, each settling in
 * slightly after the last (`.fsl-*` in globals.css) so the identity reads as one composed
 * moment rather than three things appearing at once.
 */
export default function FullScreenLoader({ message, onDark = false }: { message: string; onDark?: boolean }) {
  return (
    <div className="flex flex-col items-center gap-4">
      <BrandLogo height={36} onDark={onDark} className="fsl-logo" />
      <TeaLoader size={56} className="fsl-loader" onDark={onDark} />
      <p
        role="status"
        aria-live="polite"
        className="fsl-message text-[13px] font-medium m-0"
        style={{ color: onDark ? "rgba(255,255,255,0.88)" : "var(--text-muted)" }}
      >
        {message}
      </p>
    </div>
  );
}
