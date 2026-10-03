"use client";

import type { LandingHero } from "@/types/api";
import HeroImageCarousel from "@/components/landing/HeroImageCarousel";
import PublicTicker from "@/components/landing/PublicTicker";
import Reveal from "@/components/landing/motion/Reveal";
import Button from "@mui/material/Button";
import Link from "next/link";

/**
 * The landing page's opening section — a full-bleed slideshow (HeroImageCarousel) behind a dark
 * veil, with the headline, subhead and CTAs centred over it.
 */
export default function Hero({ hero }: { hero: LandingHero }) {
  return (
    <div id="top">
      {/* Full-bleed hero: the photo slideshow fills the whole band behind a dark veil, with the
          copy centred on top. 120px = LandingNav (68) + PublicTicker (52) above/below. */}
      <div
        className="relative overflow-hidden flex items-center justify-center min-h-[calc(100dvh-120px)]"
        style={{ background: "#0f1410" }}
      >
        <HeroImageCarousel className="absolute inset-0" />
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "linear-gradient(180deg, rgba(15,20,16,0.55) 0%, rgba(15,20,16,0.68) 100%)" }}
        />

        <div className="relative w-full max-w-5xl mx-auto px-5 sm:px-8 py-16 sm:py-24 text-center">
          <Reveal>
            <p className="font-mono text-[11px] sm:text-[12px] tracking-[0.25em] uppercase mb-5" style={{ color: "rgba(255,255,255,0.8)" }}>
              Asia Siyaka Commodities
            </p>
            <h1
              className="font-display font-bold leading-[1.06] m-0 mb-6"
              style={{ color: "#fff", fontSize: "clamp(40px, 7vw, 92px)", textShadow: "0 2px 24px rgba(0,0,0,0.35)" }}
            >
              {hero.headline}
            </h1>
            <p className="text-[16px] sm:text-[19px] leading-relaxed m-0 mb-10 mx-auto max-w-2xl" style={{ color: "rgba(255,255,255,0.88)" }}>
              {hero.subhead}
            </p>
            <div className="flex flex-wrap items-center justify-center gap-3">
              <Button component={Link} href="/login" variant="contained" color="primary" size="large">
                {hero.ctaPrimaryLabel}
              </Button>
              <Button
                component={Link}
                href="#how-it-works"
                variant="outlined"
                size="large"
                sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.6)", "&:hover": { borderColor: "#fff", background: "rgba(255,255,255,0.1)" } }}
              >
                {hero.ctaSecondaryLabel}
              </Button>
            </div>
          </Reveal>
        </div>
      </div>

      <PublicTicker />
    </div>
  );
}
