import type { LandingHero } from "@/types/api";
import PublicTicker from "@/components/landing/PublicTicker";
import Button from "@mui/material/Button";
import Link from "next/link";

/**
 * The landing page's opening section — a standard two-column marketing hero (headline/CTA
 * left, a real photograph right) on a full-width band, not confined to a dashboard-scaled
 * bordered card. Same tokens as the rest of the app (`--liquor` CTA, `font-display` Fraunces
 * headline, `--surface`/`--tea-rule`), just given landing-page proportions and breathing room.
 * The photo is the same licensed Wikimedia Commons estate shot already vetted for the login
 * page's TeaCinematic intro (public/tea/intro/ATTRIBUTION.md).
 */
export default function Hero({ hero }: { hero: LandingHero }) {
  return (
    <div id="top">
      <div className="relative overflow-hidden" style={{ background: "var(--surface)" }}>
        <div
          className="absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{ background: "radial-gradient(120% 100% at 100% 0%, var(--liquor-light) 0%, transparent 55%)" }}
        />
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-14 pb-16 sm:pt-20 sm:pb-24 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-14 items-center">
          <div>
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
          </div>

          <div className="relative aspect-[4/3] rounded-[var(--radius-xl)] overflow-hidden" style={{ boxShadow: "var(--shadow-lg)" }}>
            <div
              className="absolute inset-0 bg-cover bg-center"
              style={{ backgroundImage: "url(/tea/intro/estate-mist-hatton.webp)" }}
              role="img"
              aria-label="Misty tea estate in the Central Highlands of Sri Lanka"
            />
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
