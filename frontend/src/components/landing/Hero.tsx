import type { LandingHero } from "@/types/api";
import PublicTicker from "@/components/landing/PublicTicker";
import Button from "@mui/material/Button";
import Link from "next/link";

/**
 * The landing page's opening banner — sized and composed like the rest of this app's real
 * surfaces (a bordered `--surface` panel, `font-display text-2xl/3xl` headline, a contained
 * photo rather than a full-bleed cinematic backdrop), not a separate marketing-site register.
 * The photo is the same licensed Wikimedia Commons estate shot already vetted for the login
 * page's TeaCinematic intro (public/tea/intro/ATTRIBUTION.md).
 */
export default function Hero({ hero }: { hero: LandingHero }) {
  return (
    <div id="top">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 pt-6">
        <div
          className="rounded-[var(--radius-lg)] border border-border overflow-hidden grid grid-cols-1 lg:grid-cols-2"
          style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
        >
          <div className="p-6 sm:p-9 flex flex-col justify-center order-2 lg:order-1">
            <p className="font-mono text-[11px] tracking-[0.18em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
              Asia Siyaka Commodities · Colombo Tea Auction
            </p>
            <h1
              className="font-display font-bold leading-tight m-0 mb-3"
              style={{ color: "var(--text-strong)", fontSize: "clamp(26px, 3.2vw, 38px)" }}
            >
              {hero.headline}
            </h1>
            <p className="text-[14px] leading-relaxed m-0 mb-6" style={{ color: "var(--text-muted)" }}>
              {hero.subhead}
            </p>
            <div className="flex flex-wrap items-center gap-3">
              <Button component={Link} href="/login" variant="contained" color="primary">
                {hero.ctaPrimaryLabel}
              </Button>
              <Button component={Link} href="#how-it-works" variant="outlined" color="primary">
                {hero.ctaSecondaryLabel}
              </Button>
            </div>
          </div>
          <div className="relative h-[220px] lg:h-auto order-1 lg:order-2">
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: "url(/tea/intro/estate-mist-hatton.webp)" }}
              role="img"
              aria-label="Misty tea estate in the Central Highlands of Sri Lanka"
            />
            <div className="absolute inset-0" style={{ background: "var(--rule-brand)", opacity: 0.18 }} aria-hidden="true" />
          </div>
        </div>
      </div>

      <div className="mt-6">
        <PublicTicker />
      </div>
    </div>
  );
}
