"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import TeaLoader from "@/components/shared/TeaLoader";
import {
  FULL_SEQUENCE,
  INTRO_SEEN_KEY,
  LOGO_HOLD_MS,
  MOBILE_MAX_WIDTH,
  MOBILE_SEQUENCE,
  REDUCED_SEQUENCE,
  SHORT_SEQUENCE,
  type TeaScene,
} from "@/components/auth/teaIntroScenes";
import { useCallback, useEffect, useRef, useState } from "react";

/**
 * The login page's "Ceylon Tea Journey" — a short cinematic overlay (real Ceylon leaf →
 * misty Hatton estate → plucking → withering → graded tea becoming lot/value data → cup →
 * ASC mark) that plays above the auth card and then fades away. Presentation-only:
 *
 * - The login form is mounted and interactive underneath the whole time — the overlay is
 *   pointer-events-none except the Skip control, and any keypress skips it, so the intro
 *   can never delay or trap authentication (docs/28's "animation never blocks auth" rule).
 * - Pure CSS scenes (`.tea-cine-*` in globals.css): crossfades + transform-only Ken Burns
 *   moves, no canvas, no rAF loop, no filter blur — same GPU budget rules as .lift-on-hover.
 * - First desktop visit plays the full journey; narrow viewports get a ~3s cut with 1280px
 *   assets; after that (asc_intro_seen) a ~2.5s short cut. prefers-reduced-motion gets one
 *   static frame and a gentle fade. A scene whose image fails to load is skipped instantly —
 *   worst case the overlay is a dark ground that fades into the form.
 * - Scene art is manifest-driven (teaIntroScenes.ts; licenses in
 *   public/tea/intro/ATTRIBUTION.md) so assets swap without touching this component.
 */
export default function TeaCinematic({ onDone }: { onDone: () => void }) {
  const [scenes, setScenes] = useState<TeaScene[] | null>(null); // null until mode decided on mount
  const [small, setSmall] = useState(false);
  const [index, setIndex] = useState(0); // scenes.length = logo scene
  const [leaving, setLeaving] = useState(false);
  const doneRef = useRef(false);

  const finish = useCallback(() => {
    if (doneRef.current) return;
    doneRef.current = true;
    try {
      localStorage.setItem(INTRO_SEEN_KEY, "1");
    } catch {
      /* storage may be unavailable (private mode) — the intro just replays next time */
    }
    setLeaving(true); // fade the whole overlay, then hand back to the page
    setTimeout(onDone, 500);
  }, [onDone]);

  // Decide the sequence on mount (localStorage + media queries are browser-only).
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const narrow = window.matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches;
    setSmall(narrow);
    let seen = false;
    try {
      seen = localStorage.getItem(INTRO_SEEN_KEY) === "1";
    } catch {
      seen = true; // no storage → assume seen, keep it short
    }
    setScenes(reduced ? REDUCED_SEQUENCE : seen ? SHORT_SEQUENCE : narrow ? MOBILE_SEQUENCE : FULL_SEQUENCE);
  }, []);

  // Advance through scenes on each scene's own clock; after the last, hold on the logo.
  useEffect(() => {
    if (!scenes) return;
    if (index >= scenes.length) {
      const t = setTimeout(finish, LOGO_HOLD_MS);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setIndex((i) => i + 1), scenes[index].durationMs);
    return () => clearTimeout(t);
  }, [scenes, index, finish]);

  const srcFor = useCallback(
    (scene: TeaScene) => (small && scene.srcSmall ? scene.srcSmall : scene.src),
    [small],
  );

  // Preload the next scene's still while the current one plays.
  useEffect(() => {
    if (!scenes || index + 1 >= scenes.length) return;
    const img = new Image();
    img.src = srcFor(scenes[index + 1]);
  }, [scenes, index, srcFor]);

  // Any key skips — keyboard users are never made to wait, and focus stays wherever it
  // was in the form underneath (the overlay never takes focus except its Skip button).
  useEffect(() => {
    const onKey = () => finish();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [finish]);

  // A scene whose asset failed to load is skipped the moment it becomes (or is) active —
  // never a blank hold. The dark overlay ground itself is plain CSS and cannot fail.
  const failed = useRef(new Set<string>());
  const onSceneError = useCallback(
    (scene: TeaScene, i: number) => {
      failed.current.add(scene.id);
      setIndex((cur) => (i === cur ? cur + 1 : cur));
    },
    [],
  );

  // The branded ground under every scene: ASC mark + the house tea-leaf loader on the
  // dark ground. Scenes render above it, so it shows exactly when imagery hasn't loaded
  // yet (first paint, a slow network, a failed asset) — the wait is branded, never blank.
  const brandBase = (
    <div className="tea-cine-base" aria-hidden="true">
      <BrandLogo height={40} onDark />
      <TeaLoader size={44} onDark />
    </div>
  );

  if (!scenes) {
    // First paint before the mode is known: branded dark cover, no flash of any scene.
    return (
      <div className="tea-cine-overlay" aria-hidden="true">
        {brandBase}
      </div>
    );
  }

  const onLogo = index >= scenes.length;

  return (
    <div className={`tea-cine-overlay ${leaving ? "tea-cine-leaving" : ""}`} role="presentation">
      {/* Scenes stack; only the active one is visible. aria-hidden — this layer is purely
          decorative and the real auth UI is right underneath for assistive tech. */}
      <div aria-hidden="true">
        {brandBase}
        {scenes.map((scene, i) => (
          // The outgoing scene (index-1) stays fully opaque underneath while the new one
          // fades in over it — so mid-crossfade never dips to the base layer, and the
          // brand ground shows only when imagery genuinely hasn't painted yet.
          <div
            key={scene.id}
            className={`tea-cine-scene ${i === index ? "tea-cine-active" : i === index - 1 ? "tea-cine-under" : ""}`}
          >
            {/* Video only mounts for the active scene and the one about to enter, so two
                clips never decode/play at once; other slots hold the lightweight still. */}
            {(scene.video?.webm || scene.video?.mp4) && i >= index && i <= index + 1 ? (
              <video
                className={`tea-cine-media tea-cine-${scene.motion}`}
                autoPlay
                muted
                playsInline
                loop
                poster={srcFor(scene)}
              >
                {scene.video.webm && <source src={scene.video.webm} type="video/webm" />}
                {scene.video.mp4 && <source src={scene.video.mp4} type="video/mp4" />}
              </video>
            ) : failed.current.has(scene.id) ? null : (
              // eslint-disable-next-line @next/next/no-img-element -- full-bleed decorative
              // scene art; next/image's layout machinery buys nothing for an absolutely
              // positioned cover image and its wrapper breaks the crossfade stacking.
              <img
                className={`tea-cine-media tea-cine-${scene.motion}`}
                src={srcFor(scene)}
                alt=""
                onError={() => onSceneError(scene, i)}
              />
            )}
            {/* Cinematic caption — gold kicker + one display-serif line over a soft bottom
                scrim (plain gradient, no blur) so the words stay legible on any footage. */}
            {scene.caption && i === index && (
              <>
                <span className="tea-cine-scrim" />
                <span className="tea-cine-caption">
                  <span className="tea-cine-caption-kicker">{scene.caption.kicker}</span>
                  <span className="tea-cine-caption-line">{scene.caption.line}</span>
                </span>
              </>
            )}
            {scene.steam && i === index && (
              <span className="tea-cine-steam">
                <span />
                <span />
                <span />
              </span>
            )}
            {/* "Tea becomes data" — restrained lot/grade/value typography settling over
                the graded-tea macro. Illustrative figures, deliberately generic. */}
            {scene.data && i === index && (
              <span className="tea-cine-data">
                <span className="tea-cine-data-line">LOT 2041 · BOPF</span>
                <span className="tea-cine-data-line">SELECT BEST · Rs. 1,240/kg</span>
                <span className="tea-cine-data-rule" />
                <span className="tea-cine-data-line tea-cine-data-dim">CATALOGUE → VALUATION → INTELLIGENCE</span>
              </span>
            )}
          </div>
        ))}

        {/* Final scene: the journey resolves into the ASC mark on the dark ground. */}
        <div className={`tea-cine-scene tea-cine-logo-scene ${onLogo ? "tea-cine-active" : ""}`}>
          {onLogo && (
            <div className="tea-cine-logo">
              <BrandLogo height={56} onDark />
              <p className="font-mono text-[11px] tracking-widest uppercase m-0" style={{ color: "rgba(247,243,232,0.75)" }}>
                Intelligence Hub
              </p>
              <p className="tea-cine-logo-tag font-display m-0">
                Auction intelligence for Ceylon tea.
              </p>
              <p className="tea-cine-logo-points font-mono m-0">
                Catalogues · Valuations · Market Insight · AI Assistant
              </p>
            </div>
          )}
        </div>
      </div>

      <button type="button" className="tea-cine-skip" onClick={finish}>
        Skip intro →
      </button>
    </div>
  );
}
