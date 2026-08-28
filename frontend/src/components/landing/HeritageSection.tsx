import type { LandingHeritage } from "@/types/api";

const FALLBACK_IMAGE = "/tea/intro/plucking-nuwara-eliya.webp";

/**
 * Ceylon tea heritage editorial block. Copy comes from the CMS (Admin-editable); framed
 * explicitly as commentary, not cited data — "one of the world's most storied tea origins"
 * reads as illustrative praise, not a sourced statistic. Full-bleed image on one side, copy on
 * the other, a full-width alternating band rather than a card floating on the page.
 */
export default function HeritageSection({ heritage }: { heritage: LandingHeritage }) {
  return (
    <section style={{ background: "var(--surface-alt)" }}>
      <div className="max-w-7xl mx-auto grid grid-cols-1 lg:grid-cols-2 items-stretch">
        <div className="relative h-[260px] lg:h-auto order-1">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heritage.imageUrl || FALLBACK_IMAGE})` }}
            role="img"
            aria-label="Tea plucking near Nuwara Eliya, Sri Lanka"
          />
        </div>
        <div className="p-6 sm:p-12 lg:p-16 flex flex-col justify-center order-2">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-4" style={{ color: "var(--liquor)" }}>
            Ceylon Tea
          </p>
          <p
            className="font-display italic leading-snug m-0 mb-4"
            style={{ color: "var(--text-strong)", fontSize: "clamp(20px, 2.4vw, 28px)" }}
          >
            &ldquo;{heritage.pullQuote}&rdquo;
          </p>
          <p className="text-[14px] leading-relaxed m-0 max-w-md" style={{ color: "var(--text-muted)" }}>
            {heritage.bodyCopy}
          </p>
        </div>
      </div>
    </section>
  );
}
