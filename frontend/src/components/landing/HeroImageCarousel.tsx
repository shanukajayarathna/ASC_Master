"use client";

import { AnimatePresence, motion } from "motion/react";
import { useLiteMode } from "@/lib/liteMode";
import { useEffect, useState, type CSSProperties } from "react";

// Photographs supplied by the client, in public/tea/hero-carousel/.
const IMAGES = [
  "/tea/hero-carousel/hero-2.webp",
  "/tea/hero-carousel/tea-pickers.avif",
  "/tea/hero-carousel/scenic-rice-field.avif",
  "/tea/hero-carousel/hero-1.webp",
];

const INTERVAL_MS = 5000;

/**
 * Auto-advancing Hero photo rotation: a plain crossfade (new photo fades in while the old one
 * fades out). Purely decorative rotating imagery, so the container is aria-hidden rather than
 * exposing five changing alt texts to screen readers every 5s.
 */
export default function HeroImageCarousel({ className, style }: { className?: string; style?: CSSProperties }) {
  const [index, setIndex] = useState(0);
  // Low-end PCs: hold the first photo (no rotation = no repeated ~1 MB decodes/repaints).
  const lite = useLiteMode();

  useEffect(() => {
    if (lite) return;
    const id = setInterval(() => setIndex((i) => (i + 1) % IMAGES.length), INTERVAL_MS);
    return () => clearInterval(id);
  }, [lite]);

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
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1 }}
        />
      </AnimatePresence>
    </div>
  );
}
