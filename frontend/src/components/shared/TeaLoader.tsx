import { useId } from "react";

/**
 * The app's one branded loading animation — a glass cup of hot Ceylon tea, brewing:
 * amber liquor with a gently moving surface seen through the glass, steam wisps rising
 * continuously above the rim, and a small brand leaf resting on the saucer. The steam's
 * constant rise is what reads as "working" — no bar, no spinner, no reset jump. It also
 * mirrors the glass-cup scene in the login cinematic, so the loading mark and the brand
 * film share one visual. Pure inline SVG + CSS (keyframes in globals.css, `.tea-brew-*`),
 * transform/opacity only so it stays cheap on a weak GPU/tablet — no filters, no JS
 * animation loop. Respects prefers-reduced-motion (static cup, faint fixed steam).
 *
 * Used bare (this component alone) for small inline "this list is loading" spots; composed
 * with the real brand mark and a status line via `FullScreenLoader` for boot/route-transition
 * moments where the ASC logo should anchor the identity.
 */
export default function TeaLoader({
  size = 64,
  className,
  onDark = false,
}: {
  size?: number;
  className?: string;
  /** Set when rendering on a dark ground the ambient tokens can't be trusted on — the
   *  dark theme's frosted overlay veil, the login cinematic — where light theme's ambient
   *  tokens would resolve dark-on-dark; swaps in legible fixed values instead. */
  onDark?: boolean;
}) {
  const outline = onDark ? "#E8DCC2" : "var(--ink-700)";
  const liquor = onDark ? "#DE8B62" : "var(--liquor)";
  const liquorDeep = onDark ? "#B05A34" : "var(--liquor-dark)";
  const steam = onDark ? "rgba(247,243,232,0.85)" : "var(--ink-muted)";
  const leaf = onDark ? "#A8B45E" : "var(--sage-dark)";
  // One clip id per instance so two loaders on one page can't cross-clip each other —
  // useId rather than Math.random() so render stays pure and SSR/client markup match
  // (stripped to characters that are safe inside a url(#…) reference).
  const clipId = `tea-brew-${useId().replace(/[^a-zA-Z0-9-]/g, "")}`;

  // Interior of the glass — slightly inset from the cup outline so the liquor never
  // bleeds through the glass wall.
  const BOWL = "M30,44 C30,63 36,76 50,76 C64,76 70,63 70,44 Z";

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Loading"
    >
      <defs>
        <clipPath id={clipId}>
          <path d={BOWL} />
        </clipPath>
      </defs>

      <g className="tea-brew-root">
        {/* Steam — three staggered wisps rising and dissolving above the rim */}
        <g fill="none" style={{ stroke: steam }} strokeWidth={2.4} strokeLinecap="round">
          <path className="tea-brew-wisp" d="M40,34 C43,29 37,24 40,17" />
          <path className="tea-brew-wisp tea-brew-wisp2" d="M50,32 C53,26 47,21 50,13" />
          <path className="tea-brew-wisp tea-brew-wisp3" d="M60,34 C63,29 57,24 60,18" />
        </g>

        {/* Liquor inside the glass: wave surface sliding sideways + a slow bob, with a
            deeper tone below the surface so the tea has body */}
        <g clipPath={`url(#${clipId})`}>
          <g className="tea-brew-liquid">
            <path
              className="tea-brew-wave"
              d="M-60,49 q8,-4 16,0 t16,0 t16,0 t16,0 t16,0 t16,0 t16,0 t16,0 L160,110 L-60,110 Z"
              style={{ fill: liquor }}
            />
            <rect x="-60" y="60" width="220" height="60" style={{ fill: liquorDeep }} opacity={0.6} />
            {/* glass-side light catch on the liquor */}
            <rect x="35" y="50" width="3.5" height="22" rx="1.75" fill="#FFFFFF" opacity={0.28} />
          </g>
        </g>

        {/* Glass cup — outline with a faint wall fill so the empty part reads as glass */}
        <path
          d="M28,40 C28,64 35,78 50,78 C65,78 72,64 72,40 Z"
          style={{ fill: outline, fillOpacity: 0.07, stroke: outline }}
          strokeWidth={2.2}
          strokeLinejoin="round"
        />
        {/* handle */}
        <path
          d="M72,46 C81,45 85,52 80,59 C77,63 74,64 72,63"
          fill="none"
          style={{ stroke: outline }}
          strokeWidth={2.2}
          strokeLinecap="round"
        />
        {/* saucer */}
        <path
          d="M24,84 L76,84"
          style={{ stroke: outline }}
          strokeWidth={2.6}
          strokeLinecap="round"
          opacity={0.85}
        />
        {/* small brand leaf resting on the saucer */}
        <path
          d="M20,82 C24,76 31,76 34,80 C31,83 24,84 20,82 Z"
          style={{ fill: leaf, fillOpacity: 0.85 }}
        />
      </g>
    </svg>
  );
}
