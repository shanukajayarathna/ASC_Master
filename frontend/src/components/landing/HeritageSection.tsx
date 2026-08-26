import ScrollReveal from "@/components/landing/ScrollReveal";
import type { LandingHeritage } from "@/types/api";

const FALLBACK_IMAGE = "/tea/intro/plucking-nuwara-eliya.webp";

/**
 * Ceylon tea heritage editorial block. Copy comes from the CMS (Admin-editable); framed
 * explicitly as commentary, not cited data — "one of the world's most storied tea origins"
 * reads as illustrative praise, not a sourced statistic.
 */
export default function HeritageSection({ heritage }: { heritage: LandingHeritage }) {
  return (
    <section className="relative py-24 sm:py-32 overflow-hidden" style={{ background: "var(--warm-black)" }}>
      <div
        className="absolute inset-0 opacity-45 bg-cover bg-center"
        style={{ backgroundImage: `url(${heritage.imageUrl || FALLBACK_IMAGE})` }}
        aria-hidden="true"
      />
      <div className="absolute inset-0" aria-hidden="true" style={{ background: "linear-gradient(180deg, rgba(15,20,16,0.55), rgba(15,20,16,0.92))" }} />

      <div className="relative max-w-3xl mx-auto px-5 sm:px-8 text-center">
        <ScrollReveal>
          <p className="font-mono text-[11px] tracking-[0.24em] uppercase mb-6" style={{ color: "var(--brand-gold-soft)" }}>
            Ceylon Tea
          </p>
          <p
            className="font-display font-semibold italic leading-tight m-0 mb-8"
            style={{ color: "#FFFDF7", fontSize: "clamp(26px, 4vw, 42px)" }}
          >
            &ldquo;{heritage.pullQuote}&rdquo;
          </p>
          <p className="text-[15px] leading-relaxed max-w-xl mx-auto m-0" style={{ color: "rgba(244,241,230,0.82)" }}>
            {heritage.bodyCopy}
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
