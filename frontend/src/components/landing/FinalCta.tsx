"use client";

import Reveal from "@/components/landing/motion/Reveal";
import Button from "@mui/material/Button";
import Link from "next/link";

/** Full-width brand-gradient band — the standard closing CTA beat on a landing page, using the
 *  same `--rule-brand` gradient the dashboard's own "Continue Valuing" banner uses, now laid
 *  as a semi-transparent wash over an estate photo (same licensed Wikimedia Commons asset the
 *  login page's TeaCinematic already vetted — see public/tea/intro/ATTRIBUTION.md) rather than
 *  a flat color, so the closing beat gets photography too without losing the brand identity. */
export default function FinalCta({ ctaLabel }: { ctaLabel: string }) {
  return (
    <section className="relative overflow-hidden py-14 sm:py-16">
      <div
        className="absolute inset-0 bg-cover bg-center"
        style={{ backgroundImage: "url(/tea/intro/estate-terraces-nuwara-eliya.webp)" }}
        role="img"
        aria-label="Tea estate photograph"
      />
      <div className="absolute inset-0" aria-hidden="true" style={{ background: "var(--rule-brand)", opacity: 0.88 }} />
      <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
        <Reveal>
          <h2
            className="font-display font-bold m-0 mb-6"
            style={{ color: "#fff", fontSize: "clamp(22px, 3vw, 30px)" }}
          >
            Bring intelligence to your next sale week.
          </h2>
          <Button
            component={Link}
            href="/login"
            variant="contained"
            size="large"
            sx={{ background: "rgba(255,255,255,0.95)", color: "var(--liquor-dark)", "&:hover": { background: "#fff" } }}
          >
            {ctaLabel}
          </Button>
        </Reveal>
      </div>
    </section>
  );
}
