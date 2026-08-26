import ScrollReveal from "@/components/landing/ScrollReveal";
import type { LandingTestimonial } from "@/types/api";

/** Managed entirely through the Admin Panel CMS — this component just renders whatever the
 *  public GET returns (already filtered to `isPublished`, see LandingPageContentController). */
export default function Testimonials({ testimonials }: { testimonials: LandingTestimonial[] }) {
  if (testimonials.length === 0) return null;
  const sorted = [...testimonials].sort((a, b) => a.order - b.order);

  return (
    <section id="insights" className="py-20 sm:py-28" style={{ background: "var(--tea-ledger)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <ScrollReveal className="max-w-2xl mb-14">
          <p className="font-mono text-[11px] tracking-[0.24em] uppercase mb-4" style={{ color: "var(--tea-liquor)" }}>
            From the Floor
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "var(--tea-ink)", fontSize: "clamp(28px, 3.4vw, 44px)" }}>
            Trusted across the auction.
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {sorted.map((t) => (
            <ScrollReveal key={t.id}>
              <div className="h-full p-7 rounded-2xl bg-white" style={{ border: "1px solid var(--gold-hairline)" }}>
                <p className="font-display italic leading-relaxed m-0 mb-6" style={{ color: "var(--tea-ink)", fontSize: "17px" }}>
                  &ldquo;{t.quote}&rdquo;
                </p>
                <p className="text-[13px] font-semibold m-0" style={{ color: "var(--tea-ink)" }}>
                  {t.name}
                </p>
                <p className="font-mono text-[10.5px] tracking-[0.06em] uppercase m-0 mt-0.5" style={{ color: "var(--tea-leaf)" }}>
                  {t.role}
                </p>
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
