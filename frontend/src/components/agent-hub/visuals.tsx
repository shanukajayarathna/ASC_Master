"use client";

import { useId, useRef } from "react";
import { useSvgAnimation } from "./useHubEnv";

/**
 * The General (ask box) visual — original animated SVG, generated in code (SMIL for motion along paths and
 * radius changes, CSS keyframes in agent-hub.css for the rest). No images, no libraries, each a few KB.
 *
 * Contract shared by all of them:
 *  - `run` false pauses every animation (tile off-screen, or reduced motion).
 *  - `frozen` (reduced motion) additionally jumps SMIL to a composed frame, and the CSS animations are
 *    switched off in the stylesheet, so a still image is shown instead of a mid-loop accident.
 *  - Colours come from CSS variables the tile sets (--hub-a accent, --hub-b, --hub-c supporting
 *    lights), so the same markup works in the dark and light hub themes.
 *  - Purely decorative: aria-hidden, not focusable.
 */
interface VisualProps {
  run: boolean;
  frozen: boolean;
}

function Svg({ viewBox, run, frozen, children }: VisualProps & { viewBox: string; children: React.ReactNode }) {
  const ref = useRef<SVGSVGElement>(null);
  useSvgAnimation(ref, run, frozen);
  return (
    <svg ref={ref} viewBox={viewBox} className="hub-svg" data-run={run ? "true" : "false"} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

// ---------------------------------------------------------------------------- General
/** A glowing core with three tilted orbit rings, each carrying an orbiting light; halo pulses, stars twinkle. */
export function GeneralVisual(props: VisualProps) {
  const id = useId();
  const core = `${id}-core`;
  const orbit = (rx: number, ry: number) => `M ${220 - rx} 135 a ${rx} ${ry} 0 1 0 ${rx * 2} 0 a ${rx} ${ry} 0 1 0 ${-rx * 2} 0`;
  const stars: [number, number, number, number][] = [
    [38, 40, 1.6, 0], [92, 232, 1.2, 1.3], [402, 46, 1.8, 0.7], [376, 226, 1.3, 2.1],
    [330, 20, 1.1, 1.6], [60, 150, 1.4, 2.6], [414, 150, 1.2, 0.4], [150, 18, 1.3, 3.1],
  ];
  return (
    <Svg viewBox="0 0 440 270" {...props}>
      <defs>
        <radialGradient id={core}>
          <stop offset="0%" stopColor="#FFF1CF" />
          <stop offset="34%" stopColor="var(--hub-a)" />
          <stop offset="70%" stopColor="var(--hub-a)" stopOpacity="0.32" />
          <stop offset="100%" stopColor="var(--hub-a)" stopOpacity="0" />
        </radialGradient>
      </defs>
      {stars.map(([x, y, r, delay], i) => (
        <circle key={i} cx={x} cy={y} r={r} fill="var(--hub-ink)" opacity="0.5">
          <animate attributeName="opacity" values="0.15;0.95;0.15" dur={`${3 + (i % 3)}s`} begin={`${delay}s`} repeatCount="indefinite" />
        </circle>
      ))}
      <circle cx="220" cy="135" r="120" fill={`url(#${core})`} opacity="0.55">
        <animate attributeName="r" values="108;130;108" dur="5s" repeatCount="indefinite" />
      </circle>
      <g transform="rotate(-24 220 135)">
        <ellipse cx="220" cy="135" rx="150" ry="44" fill="none" stroke="var(--hub-a)" strokeOpacity="0.5" strokeWidth="1.2" />
        <circle r="5.5" fill="var(--hub-a)">
          <animateMotion dur="9s" repeatCount="indefinite" path={orbit(150, 44)} />
        </circle>
      </g>
      <g transform="rotate(30 220 135)">
        <ellipse cx="220" cy="135" rx="122" ry="58" fill="none" stroke="var(--hub-b)" strokeOpacity="0.5" strokeWidth="1.2" />
        <circle r="4.5" fill="var(--hub-b)">
          <animateMotion dur="13s" repeatCount="indefinite" path={orbit(122, 58)} />
        </circle>
      </g>
      <g transform="rotate(86 220 135)">
        <ellipse cx="220" cy="135" rx="98" ry="34" fill="none" stroke="var(--hub-c)" strokeOpacity="0.45" strokeWidth="1.2" />
        <circle r="4" fill="var(--hub-c)">
          <animateMotion dur="17s" repeatCount="indefinite" path={orbit(98, 34)} keyPoints="1;0" keyTimes="0;1" calcMode="linear" />
        </circle>
      </g>
      <circle cx="220" cy="135" r="30" fill={`url(#${core})`} />
      <circle cx="220" cy="135" r="13" fill="#FFF1CF">
        <animate attributeName="r" values="12;15;12" dur="3.4s" repeatCount="indefinite" />
      </circle>
    </Svg>
  );
}
