import type { LandingHero } from "@/types/api";
import PublicTicker from "@/components/landing/PublicTicker";

/**
 * Full-bleed cinematic hero — reuses the same licensed Wikimedia Commons estate photography
 * already vetted for the login page's TeaCinematic intro (see
 * public/tea/intro/ATTRIBUTION.md), rather than pulling in unverified stock imagery. The one
 * Ken Burns zoom on this whole page lives here (`.landing-hero-zoom`, 26s, subtle).
 */
export default function Hero({ hero }: { hero: LandingHero }) {
  return (
    <div id="top" className="relative">
      <div className="relative w-full overflow-hidden" style={{ height: "min(92vh, 900px)", minHeight: 560 }}>
        <div
          className="absolute inset-0 landing-hero-zoom bg-cover bg-center"
          style={{ backgroundImage: "url(/tea/intro/estate-mist-hatton.webp)" }}
          aria-hidden="true"
        />
        <div
          className="absolute inset-0"
          aria-hidden="true"
          style={{
            background:
              "linear-gradient(180deg, rgba(15,20,16,0.55) 0%, rgba(15,20,16,0.35) 40%, rgba(15,20,16,0.85) 100%)",
          }}
        />

        <div className="relative h-full flex items-center">
          <div className="max-w-7xl mx-auto px-5 sm:px-8 w-full">
            <div className="max-w-2xl">
              <p className="font-mono text-[11px] tracking-[0.28em] uppercase mb-5" style={{ color: "var(--brand-gold-soft)" }}>
                Asia Siyaka Commodities · Colombo Tea Auction
              </p>
              <h1
                className="font-display font-bold leading-[1.05] m-0 mb-6"
                style={{ color: "#FFFDF7", fontSize: "clamp(40px, 6vw, 88px)", textShadow: "0 4px 24px rgba(0,0,0,0.35)" }}
              >
                {hero.headline}
              </h1>
              <p
                className="text-[16px] sm:text-[18px] leading-relaxed max-w-xl mb-9"
                style={{ color: "rgba(244,241,230,0.92)" }}
              >
                {hero.subhead}
              </p>
              <div className="flex flex-wrap items-center gap-4">
                <a
                  href="/login"
                  className="no-underline inline-flex items-center px-7 py-3.5 rounded-full text-[14px] font-semibold transition-transform hover:-translate-y-0.5"
                  style={{ background: "var(--tea-liquor)", color: "var(--tea-ink)" }}
                >
                  {hero.ctaPrimaryLabel}
                </a>
                <a
                  href="#how-it-works"
                  className="no-underline inline-flex items-center px-7 py-3.5 rounded-full text-[14px] font-semibold border transition-colors hover:bg-white/10"
                  style={{ borderColor: "rgba(244,241,230,0.45)", color: "#FFFDF7" }}
                >
                  {hero.ctaSecondaryLabel}
                </a>
              </div>
            </div>
          </div>
        </div>
      </div>

      <PublicTicker />
    </div>
  );
}
