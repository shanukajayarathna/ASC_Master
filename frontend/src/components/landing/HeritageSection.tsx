import type { LandingHeritage } from "@/types/api";

const FALLBACK_IMAGE = "/tea/intro/plucking-nuwara-eliya.webp";

/**
 * Ceylon tea heritage editorial block. Copy comes from the CMS (Admin-editable); framed
 * explicitly as commentary, not cited data — "one of the world's most storied tea origins"
 * reads as illustrative praise, not a sourced statistic. Bordered `--surface` panel with a
 * contained image, matching AboutSection/ModuleTile's card language rather than a full-bleed
 * dark cinematic treatment.
 */
export default function HeritageSection({ heritage }: { heritage: LandingHeritage }) {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <div
        className="rounded-[var(--radius-lg)] border border-border overflow-hidden grid grid-cols-1 lg:grid-cols-2"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
      >
        <div className="relative h-[200px] lg:h-auto">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url(${heritage.imageUrl || FALLBACK_IMAGE})` }}
            role="img"
            aria-label="Tea plucking near Nuwara Eliya, Sri Lanka"
          />
        </div>
        <div className="p-6 sm:p-9 flex flex-col justify-center">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
            Ceylon Tea
          </p>
          <p className="font-display text-[20px] sm:text-[24px] font-semibold italic leading-snug m-0 mb-3" style={{ color: "var(--text-strong)" }}>
            &ldquo;{heritage.pullQuote}&rdquo;
          </p>
          <p className="text-[13.5px] leading-relaxed m-0" style={{ color: "var(--text-muted)" }}>
            {heritage.bodyCopy}
          </p>
        </div>
      </div>
    </div>
  );
}
