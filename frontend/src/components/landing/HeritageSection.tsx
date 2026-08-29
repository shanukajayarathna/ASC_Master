"use client";

import type { LandingHeritage } from "@/types/api";
import Reveal from "@/components/landing/motion/Reveal";
import { motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { useRef } from "react";

const FALLBACK_IMAGE = "/tea/intro/plucking-nuwara-eliya.webp";

/**
 * Ceylon tea heritage editorial block. Copy comes from the CMS (Admin-editable); framed
 * explicitly as commentary, not cited data — "one of the world's most storied tea origins"
 * reads as illustrative praise, not a sourced statistic. Full-bleed image on one side, copy on
 * the other, a full-width alternating band rather than a card floating on the page.
 */
export default function HeritageSection({ heritage }: { heritage: LandingHeritage }) {
  const sectionRef = useRef<HTMLElement>(null);
  const reduceMotion = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: sectionRef, offset: ["start end", "end start"] });
  const y = useTransform(scrollYProgress, [0, 1], [-20, 20]);

  return (
    <section ref={sectionRef} style={{ background: "var(--surface-alt)" }}>
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 items-stretch">
        <div className="relative h-[260px] lg:h-auto order-1 overflow-hidden">
          <motion.div
            className="absolute inset-0 bg-cover bg-center"
            style={{
              backgroundImage: `url(${heritage.imageUrl || FALLBACK_IMAGE})`,
              scale: 1.2,
              y: reduceMotion ? 0 : y,
            }}
            role="img"
            aria-label="Ceylon tea heritage photograph"
          />
        </div>
        {/* This band is deliberately edge-to-edge (no horizontal padding on the grid), so a
            left/right Reveal offset would translate content past the viewport edge before it
            settles — "up" keeps the entrance purely vertical, safe on a full-bleed layout. */}
        <Reveal direction="up" className="p-6 sm:p-12 lg:p-16 flex flex-col justify-center order-2">
          <h2 className="font-mono font-normal text-[11px] tracking-[0.2em] uppercase mb-4 m-0" style={{ color: "var(--liquor)" }}>
            Ceylon Tea
          </h2>
          <blockquote className="m-0">
            <p
              className="font-display italic leading-snug m-0 mb-4"
              style={{ color: "var(--text-strong)", fontSize: "clamp(20px, 2.4vw, 28px)" }}
            >
              &ldquo;{heritage.pullQuote}&rdquo;
            </p>
            <p className="text-[14px] leading-relaxed m-0 max-w-md" style={{ color: "var(--text-muted)" }}>
              {heritage.bodyCopy}
            </p>
          </blockquote>
        </Reveal>
      </div>
    </section>
  );
}
