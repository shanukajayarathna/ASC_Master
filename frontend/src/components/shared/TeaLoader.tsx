/**
 * The app's one branded loading animation — a refined tea-leaf silhouette with a thin
 * data-flow line beneath it, standing in for "tea → data → intelligence" rather than a
 * literal cup/steam illustration (which read as a tea-shop mark, not an enterprise
 * auction-intelligence one — see docs/28_Loading_And_Interaction_States.md). Pure inline
 * SVG + CSS (keyframes in globals.css, `.tea-loader-*`), transform/opacity/stroke-dashoffset
 * only so it stays cheap on a weak GPU/tablet, same reasoning as `.lift-on-hover`. Respects
 * prefers-reduced-motion.
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
  /** `FullScreenLoader`'s dark backdrop (`--ink-solid-900`) is fixed regardless of the app's
   *  own light/dark theme (see NavigationLoader's doc comment for why it's opaque, not a
   *  scrim), so the leaf can't just follow the ambient `--sage-dark`/`--liquor` theme tokens
   *  the way it does everywhere else — in light theme those resolve dark-on-dark and the leaf
   *  all but disappears. This swaps in the dark-theme token *values* directly when true. */
  onDark?: boolean;
}) {
  const leafStroke = onDark ? "#A8B45E" : "var(--sage-dark)";
  const flowStroke = onDark ? "#DE8B62" : "var(--liquor)";
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      className={className}
      role="img"
      aria-label="Loading"
    >
      {/* Refined leaf — outline with a faint fill for depth, not a flat cartoon shape */}
      <g className="tea-loader-leaf">
        <path
          d="M50,15 C61,21 64,36 53,48 C51,50 50,52 50,52 C50,52 49,50 47,48 C36,36 39,21 50,15 Z"
          style={{ fill: leafStroke, fillOpacity: 0.22, stroke: leafStroke }}
          strokeWidth={1.8}
        />
        <path d="M50,19 Q53,35 50,49" fill="none" style={{ stroke: leafStroke }} strokeWidth={1} opacity={0.55} />
      </g>

      {/* Data-flow line — a thin dashed arc beneath the leaf, animated to read as data moving
          through the platform rather than a decorative flourish. */}
      <path
        className="tea-loader-flow"
        d="M15,72 Q50,62 85,72"
        fill="none"
        style={{ stroke: flowStroke }}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeDasharray="1 6"
        opacity={0.6}
      />
    </svg>
  );
}
