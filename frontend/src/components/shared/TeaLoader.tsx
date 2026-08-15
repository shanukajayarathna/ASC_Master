/**
 * The app's one branded loading animation — a Ceylon tea leaf silhouette steadily FILLING
 * with tea liquor, like liquor rising in a tasting glass: outline of the leaf in brand
 * olive, amber liquid rising inside it with a gently moving surface wave. Reads instantly
 * as "working on it" (the fill is the activity) while staying unmistakably this company's
 * mark. Pure inline SVG + CSS (keyframes in globals.css, `.tea-fill-*`), transform/opacity
 * only so it stays cheap on a weak GPU/tablet — no filters, no JS animation loop. Respects
 * prefers-reduced-motion (static two-thirds-filled leaf).
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
  /** Full-screen overlays use a fixed dark backdrop regardless of theme — in light theme
   *  the ambient tokens would resolve dark-on-dark there, so swap in the dark-theme token
   *  values directly (same reasoning as the previous leaf design). */
  onDark?: boolean;
}) {
  const leafStroke = onDark ? "#A8B45E" : "var(--sage-dark)";
  const liquor = onDark ? "#DE8B62" : "var(--liquor)";
  const liquorDeep = onDark ? "#C87249" : "var(--liquor-dark)";
  // One clip id per instance so two loaders on one page can't cross-clip each other.
  const clipId = `tea-fill-${Math.round(Math.random() * 1e9)}`;

  // The leaf silhouette — drawn once for the outline, reused as the liquid's clip.
  const LEAF_PATH =
    "M50,10 C69,20 76,45 59,67 C55,72 52,78 50,85 C48,78 45,72 41,67 C24,45 31,20 50,10 Z";

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
          <path d={LEAF_PATH} />
        </clipPath>
      </defs>

      <g className="tea-fill-float">
        {/* Empty leaf: faint body so the unfilled part reads as glass, not a hole */}
        <path d={LEAF_PATH} style={{ fill: leafStroke, fillOpacity: 0.1 }} />

        {/* The rising liquor, clipped to the leaf. Outer group rises; the wave path inside
            slides horizontally so the surface keeps moving while it climbs. */}
        <g clipPath={`url(#${clipId})`}>
          <g className="tea-fill-rise">
            <path
              className="tea-fill-wave"
              d="M-60,12 q10,-6 20,0 t20,0 t20,0 t20,0 t20,0 t20,0 t20,0 t20,0 L160,120 L-60,120 Z"
              style={{ fill: liquor }}
            />
            {/* deeper tone below the surface so the liquid has body, not a flat swatch */}
            <rect x="-60" y="30" width="220" height="90" style={{ fill: liquorDeep }} opacity={0.55} />
          </g>
        </g>

        {/* Leaf outline + midrib on top of the liquid */}
        <path
          d={LEAF_PATH}
          fill="none"
          style={{ stroke: leafStroke }}
          strokeWidth={2.4}
          strokeLinejoin="round"
        />
        <path
          d="M50,16 C53,38 53,60 50,80"
          fill="none"
          style={{ stroke: leafStroke }}
          strokeWidth={1.3}
          opacity={0.5}
        />
      </g>
    </svg>
  );
}
