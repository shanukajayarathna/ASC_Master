"use client";

import type { LandingHero } from "@/types/api";
import HeroImageCarousel from "@/components/landing/HeroImageCarousel";
import PublicTicker from "@/components/landing/PublicTicker";
import Reveal from "@/components/landing/motion/Reveal";
import Button from "@mui/material/Button";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import Link from "next/link";
import { useRef } from "react";

/**
 * The landing page's opening section — a standard two-column marketing hero (headline/CTA
 * left, a rotating photograph right via HeroImageCarousel) on a full-width band, not confined
 * to a dashboard-scaled bordered card. Same tokens as the rest of the app (`--liquor` CTA,
 * `font-display` Fraunces headline, `--surface`/`--tea-rule`), just given landing-page
 * proportions and breathing room. The scroll-parallax `y` transform below wraps the whole
 * carousel (not any single photo) so it keeps working across every rotation.
 */
export default function Hero({ hero }: { hero: LandingHero }) {
  const bandRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: bandRef, offset: ["start start", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [0, 28]);

  return (
    <div id="top">
      <div
        ref={bandRef}
        // Content-sized alone, the band falls well short of one screen on tall/high-res
        // monitors, leaving ProblemSection's dark band peeking in before any scroll — desktop
        // only (lg:) since mobile already fills the fold naturally. 120px = LandingNav's
        // min-h-[68px] + PublicTicker's minHeight:52 sitting above this band.
        className="relative overflow-hidden lg:min-h-[calc(100dvh-120px)] lg:flex lg:flex-col lg:justify-center"
        style={{ background: "var(--surface)" }}
      >
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(120% 100% at 100% 0%, var(--liquor-light) 0%, transparent 55%)" }}
        />
        {/* Subtle drifting gradient glow — the "futuristic" motion touch the brief calls for,
            kept faint and slow (14s, opacity capped at 0.35) so it reads as ambient depth
            rather than a distraction behind the headline. Skipped entirely under reduced
            motion; the static radial gradient above already carries the same warmth. */}
        {!reduceMotion && (
          <motion.div
            className="absolute -top-1/3 -right-1/4 w-[60vw] h-[60vw] rounded-full pointer-events-none"
            aria-hidden="true"
            style={{ background: "radial-gradient(circle, var(--brand-gold-soft) 0%, transparent 70%)", filter: "blur(60px)" }}
            animate={{ opacity: [0.15, 0.35, 0.15], scale: [1, 1.08, 1] }}
            transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
          />
        )}
        <div className="relative w-full max-w-7xl mx-auto px-4 sm:px-6 pt-14 pb-16 sm:pt-20 sm:pb-24 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <Reveal>
            <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: "var(--liquor)" }}>
              Asia Siyaka Commodities · Colombo Tea Auction
            </p>
            <h1
              className="font-display font-bold leading-[1.08] m-0 mb-5"
              style={{ color: "var(--text-strong)", fontSize: "clamp(32px, 4.4vw, 56px)" }}
            >
              {hero.headline}
            </h1>
            <p className="text-[15px] sm:text-[16px] leading-relaxed m-0 mb-8 max-w-lg" style={{ color: "var(--text-muted)" }}>
              {hero.subhead}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button component={Link} href="/login" variant="contained" color="primary" size="large">
                {hero.ctaPrimaryLabel}
              </Button>
              <Button component={Link} href="#how-it-works" variant="outlined" color="primary" size="large">
                {hero.ctaSecondaryLabel}
              </Button>
            </div>
          </Reveal>

          <div className="relative aspect-[4/3] rounded-[var(--radius-xl)] overflow-hidden" style={{ boxShadow: "var(--shadow-lg)" }}>
            <motion.div
              className="absolute inset-0"
              style={{ top: -36, bottom: -36, y: reduceMotion ? 0 : y }}
            >
              <HeroImageCarousel className="absolute inset-0" />
            </motion.div>
            <div
              className="absolute inset-0"
              aria-hidden="true"
              style={{ background: "linear-gradient(200deg, transparent 55%, rgba(15,20,16,0.35) 100%)" }}
            />
          </div>
        </div>
      </div>

      <PublicTicker />
    </div>
  );
}
