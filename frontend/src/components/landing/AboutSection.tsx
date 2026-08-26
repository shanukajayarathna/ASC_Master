import ScrollReveal from "@/components/landing/ScrollReveal";
import type { LandingCompanyStats } from "@/types/api";

function formatKg(kg: number): string {
  if (kg >= 1_000_000) return `${(kg / 1_000_000).toFixed(kg % 1_000_000 === 0 ? 0 : 1)}M kg`;
  if (kg >= 1_000) return `${Math.round(kg / 1_000)}K kg`;
  return `${kg} kg`;
}

/**
 * About Asia Siyaka Commodities — company credibility section. All figures come from the
 * CMS (Admin-editable), seeded with realistic placeholder values on first run rather than
 * invented-and-presented-as-fact numbers.
 */
export default function AboutSection({ stats }: { stats: LandingCompanyStats }) {
  const items = [
    { label: "Founded", value: String(stats.foundedYear) },
    { label: "Years operating", value: `${stats.yearsOperating}+` },
    { label: "Avg. annual volume", value: formatKg(stats.avgAnnualVolumeKg) },
    { label: "Brokers on the floor", value: String(stats.brokerCount) },
  ];

  return (
    <section id="about" className="py-20 sm:py-28" style={{ background: "var(--tea-ledger)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8 grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
        <ScrollReveal className="relative rounded-2xl overflow-hidden aspect-[4/3]">
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url(/tea/intro/estate-terraces-nuwara-eliya.webp)" }}
          />
        </ScrollReveal>

        <ScrollReveal>
          <p className="font-mono text-[11px] tracking-[0.24em] uppercase mb-4" style={{ color: "var(--tea-liquor)" }}>
            About Asia Siyaka Commodities
          </p>
          <h2 className="font-display font-bold m-0 mb-5" style={{ color: "var(--tea-ink)", fontSize: "clamp(28px, 3.4vw, 44px)" }}>
            A brokerage built on a century of Colombo auction trust.
          </h2>
          <p className="text-[15px] leading-relaxed m-0 mb-9" style={{ color: "var(--tea-leaf)" }}>
            Asia Siyaka Commodities is one of the Colombo tea auction&rsquo;s established
            brokerages — trusted by estates, factories and buyers to move volume through the
            floor accurately, every sale week. This platform is how that trust extends into
            the next generation of tools.
          </p>

          <div className="grid grid-cols-2 gap-6 pt-6" style={{ borderTop: "1px solid var(--gold-hairline)" }}>
            {items.map((s) => (
              <div key={s.label}>
                <p className="font-display font-bold m-0" style={{ color: "var(--tea-ink)", fontSize: "clamp(24px, 2.6vw, 32px)" }}>
                  {s.value}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.1em] uppercase m-0 mt-1" style={{ color: "var(--tea-leaf)" }}>
                  {s.label}
                </p>
              </div>
            ))}
          </div>
        </ScrollReveal>
      </div>
    </section>
  );
}
