"use client";

import Reveal from "@/components/landing/motion/Reveal";

/**
 * Sets up why the platform exists. Static editorial copy — not part of the CMS content model
 * (Section 5.1 covers hero/stats/intelligences/testimonials/heritage, deliberately not this
 * framing section), so there's nothing here for an Admin to edit. A full-bleed photo band
 * (dark overlay + centered text), the standard "problem statement" beat between a hero and
 * the feature grid that follows it. Background photo reuses the same licensed Wikimedia
 * Commons asset pool the login page's TeaCinematic already vetted (see
 * public/tea/intro/ATTRIBUTION.md) — a factory/processing scene, matching the "manual craft"
 * framing of the copy — rather than sourcing a new image for a single band.
 *
 * Copy names the fragmentation explicitly (paper/Excel, siloed broker records, delayed
 * reporting) and the shift being made (manual → digitalized/automated end-to-end), rather
 * than only gesturing at "it's slow" — this is the one narrative beat the rest of the landing
 * page (capabilities grid, process strip, company history) doesn't otherwise carry on its own.
 */
export default function ProblemSection() {
  return (
    <section className="relative overflow-hidden py-16 sm:py-20">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/tea/intro/withering-troughs-damro.webp)" }}
        role="img"
        aria-label="Tea processing photograph"
      />
      <div className="absolute inset-0" aria-hidden="true" style={{ background: "rgba(12,15,10,0.78)" }} />
      <div className="relative max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <Reveal>
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "rgba(255,255,255,0.8)" }}>
            The Problem
          </p>
          <h2 className="font-display font-normal text-[19px] sm:text-[22px] leading-snug m-0 mb-3" style={{ color: "#fff" }}>
            Every sale week, catalogues get re-keyed by hand, valuations get built from memory
            and last season&rsquo;s notebook, and reports get assembled overnight — each broker
            desk, estate and factory keeping its own version in its own spreadsheet.
          </h2>
          <p className="text-[13.5px] sm:text-[14px] leading-relaxed m-0" style={{ color: "rgba(255,255,255,0.78)" }}>
            Auction intelligence is still a manual, fragmented craft. ASIS digitalizes and
            automates that process end-to-end — one connected workflow in place of a slow one
            spread across paper, Excel and memory.
          </p>
        </Reveal>
      </div>
    </section>
  );
}
