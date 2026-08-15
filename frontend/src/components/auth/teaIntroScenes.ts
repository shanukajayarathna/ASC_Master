/**
 * Scene manifest for the login page's "Ceylon Tea Journey" cinematic (TeaCinematic.tsx).
 *
 * Every photographic scene is real, verified-license Ceylon imagery (Wikimedia Commons —
 * sources, authors, and licenses in public/tea/intro/ATTRIBUTION.md). Each has a 2560px
 * desktop and a 1280px mobile (`srcSmall`) WebP variant. The tea-cup scene is still a
 * crafted placeholder: no legally clean cup photograph was found (ATTRIBUTION.md documents
 * exactly what to replace it with). Swapping any asset is a data-only change here.
 */

export interface TeaScene {
  id: string;
  /** Still image (also the poster while a video, if any, buffers). */
  src: string;
  /** Smaller variant served to narrow viewports. */
  srcSmall?: string;
  /** Optional real footage for the scene — used instead of the still when present. */
  video?: { webm?: string; mp4?: string };
  alt: string;
  /** How long the scene holds before the next crossfade starts (ms). */
  durationMs: number;
  /** Ken Burns treatment applied while the scene is active (classes in globals.css). */
  motion: "drift" | "zoom-in" | "pan" | "zoom-out" | "settle";
  /** Render the CSS steam wisps over this scene (tea-cup only). */
  steam?: boolean;
  /** Render the subtle lot/grade "tea becomes data" typography over this scene. */
  data?: boolean;
  /** Cinematic caption: a small uppercase kicker + one display-serif line. */
  caption?: { kicker: string; line: string };
}

const SCENES: Record<string, TeaScene> = {
  /** Real Ceylon tea bushes, Nuwara Eliya — opens close and pulls back: leaf → bush. */
  leaf: {
    id: "leaf",
    src: "/tea/intro/tea-leaves-nuwara-eliya.webp",
    srcSmall: "/tea/intro/tea-leaves-nuwara-eliya-sm.webp",
    alt: "",
    durationMs: 900,
    motion: "zoom-out",
    caption: { kicker: "Ceylon Tea", line: "It begins with the leaf." },
  },
  /** Hatton tea fields under morning mist — the Central Highlands establishing shot. */
  estateMist: {
    id: "estateMist",
    src: "/tea/intro/estate-mist-hatton.webp",
    srcSmall: "/tea/intro/estate-mist-hatton-sm.webp",
    alt: "",
    durationMs: 1000,
    motion: "pan",
    caption: { kicker: "The Central Highlands", line: "Grown in the island's high-country mists." },
  },
  /** Terraced Nuwara Eliya estate in full morning light (CC0) — mobile's estate beat. */
  estateTerraces: {
    id: "estateTerraces",
    src: "/tea/intro/estate-terraces-nuwara-eliya.webp",
    srcSmall: "/tea/intro/estate-terraces-nuwara-eliya-sm.webp",
    alt: "",
    durationMs: 900,
    motion: "pan",
    caption: { kicker: "The Central Highlands", line: "Rolling estates. Generations of craft." },
  },
  /** Documentary shot of a tea plucker at work near Nuwara Eliya. */
  plucking: {
    id: "plucking",
    src: "/tea/intro/plucking-nuwara-eliya.webp",
    srcSmall: "/tea/intro/plucking-nuwara-eliya-sm.webp",
    alt: "",
    durationMs: 900,
    motion: "drift",
    caption: { kicker: "At Origin", line: "Hand-plucked, estate by estate." },
  },
  /** Withering troughs full of fresh leaf, Damro factory, Nuwara Eliya. */
  withering: {
    id: "withering",
    src: "/tea/intro/withering-troughs-damro.webp",
    srcSmall: "/tea/intro/withering-troughs-damro-sm.webp",
    alt: "",
    durationMs: 900,
    motion: "settle",
    caption: { kicker: "The Craft", line: "Withered, rolled, and fired to grade." },
  },
  /** Macro of graded Ceylon black tea (golden tips) on sample foil — the grading/auction
   *  beat; the data overlay renders on top: tea becoming lot, grade, and value. */
  grading: {
    id: "grading",
    src: "/tea/intro/ceylon-tea-grading-macro.webp",
    srcSmall: "/tea/intro/ceylon-tea-grading-macro-sm.webp",
    alt: "",
    durationMs: 1500,
    motion: "zoom-in",
    data: true,
    caption: { kicker: "The Colombo Auction", line: "Every lot valued. Every grade known." },
  },
  /** Freshly brewed black tea in glassware (CC BY-SA, low-key color grade applied) —
   *  the CSS steam wisps give the still its life. */
  teaCup: {
    id: "teaCup",
    src: "/tea/intro/tea-cup-glass.webp",
    srcSmall: "/tea/intro/tea-cup-glass-sm.webp",
    alt: "",
    durationMs: 900,
    motion: "settle",
    steam: true,
    caption: { kicker: "Asia Siyaka Commodities", line: "Where Ceylon tea meets the market." },
  },
};

/** First-ever visit, desktop: the full journey (~6s of scenes + logo ≈ 7s). */
export const FULL_SEQUENCE: TeaScene[] = [
  SCENES.leaf,
  SCENES.estateMist,
  SCENES.plucking,
  SCENES.withering,
  SCENES.grading,
  SCENES.teaCup,
];

/** First-ever visit, narrow viewport: leaf → estate → cup (~2.6s + logo ≈ 3.8s). */
export const MOBILE_SEQUENCE: TeaScene[] = [
  { ...SCENES.leaf, durationMs: 800 },
  SCENES.estateTerraces,
  { ...SCENES.teaCup, durationMs: 800 },
];

/** Returning visit: leaf → cup → logo (~2.8s total). */
export const SHORT_SEQUENCE: TeaScene[] = [
  { ...SCENES.leaf, durationMs: 700 },
  SCENES.teaCup,
];

/** prefers-reduced-motion: one static frame, no Ken Burns, then the logo fade. */
export const REDUCED_SEQUENCE: TeaScene[] = [
  { ...SCENES.estateMist, durationMs: 900, motion: "settle" },
];

/** How long the ASC logo scene holds after the last tea scene (ms). */
export const LOGO_HOLD_MS = 1200;

/** localStorage key remembering that this browser has seen the full journey once. */
export const INTRO_SEEN_KEY = "asc_intro_seen";

/** Viewport below this uses `srcSmall` variants and the mobile sequence. */
export const MOBILE_MAX_WIDTH = 767;
