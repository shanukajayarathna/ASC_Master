"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";

// Five licensed Wikimedia Commons photographs, distinct from every other image already used
// elsewhere on the landing page/login intro — see public/tea/hero-carousel/ATTRIBUTION.md for
// source/author/license per file.
const IMAGES = [
  "/tea/hero-carousel/haputale-estate.jpg",
  "/tea/hero-carousel/wewalthalawa-mist.jpg",
  "/tea/hero-carousel/ceylon-black-tea-macro-2.jpg",
  "/tea/hero-carousel/tea-estate-workers.jpg",
  "/tea/hero-carousel/loolkandura-first-estate.jpg",
];

const INTERVAL_MS = 5000;

/**
 * Auto-advancing Hero photo rotation: each change is a circular iris — the outgoing photo
 * closes to a point at center while sliding left and fading, the incoming one opens from a
 * point at center while sliding in from the right and fading in — rather than a plain
 * crossfade, per the brief's "circle inward with fadeout, futuristic" request. Purely
 * decorative rotating background imagery (the page's actual message is the text column next
 * to it), so the container is aria-hidden rather than exposing five changing alt texts to
 * screen readers every 5s. Under prefers-reduced-motion the photos still rotate (real content,
 * not just decoration) but via a plain opacity crossfade — no clip-path/slide motion.
 */
export default function HeroImageCarousel({ className, style }: { className?: string; style?: CSSProperties }) {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    const id = setInterval(() => setIndex((i) => (i + 1) % IMAGES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return (
    // No `position` here: the caller's className (every current call site passes
    // "absolute inset-0") must be free to control positioning itself — an inline
    // `position: relative` here would win the cascade over that class and break it,
    // which is exactly what happened the first time this was written.
    <div className={`overflow-hidden ${className ?? ""}`} style={style} aria-hidden="true">
      <AnimatePresence initial={false}>
        <motion.div
          key={IMAGES[index]}
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url(${IMAGES[index]})` }}
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 50, clipPath: "circle(0% at 50% 50%)" }}
          animate={reduceMotion ? { opacity: 1 } : { opacity: 1, x: 0, clipPath: "circle(100% at 50% 50%)" }}
          exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: -50, clipPath: "circle(0% at 50% 50%)" }}
          transition={{ duration: 1.1, ease: [0.16, 1, 0.3, 1] }}
        />
      </AnimatePresence>
    </div>
  );
}
