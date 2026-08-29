"use client";

import type { LandingTestimonial } from "@/types/api";
import Reveal from "@/components/landing/motion/Reveal";

/** First letters of up to the first two words of a name, e.g. "Senior Broker" -> "SB". These
 *  are placeholder/generic roles today (see LandingPageContentSeed), not real photographed
 *  people, so a real avatar photo is only shown once an admin explicitly sets one — no stock
 *  "person" photos are substituted here, which would misrepresent a testimonial as belonging
 *  to someone it doesn't. */
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts[0]?.[0] ?? "").toUpperCase() + (parts[1]?.[0] ?? "").toUpperCase();
}

function Avatar({ testimonial }: { testimonial: LandingTestimonial }) {
  if (testimonial.avatarUrl) {
    return (
      <div
        className="w-10 h-10 rounded-full bg-cover bg-center shrink-0"
        style={{ backgroundImage: `url(${testimonial.avatarUrl})` }}
        role="img"
        aria-label={testimonial.name}
      />
    );
  }
  return (
    <div
      className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 font-mono text-[12px] font-semibold"
      style={{ background: "var(--liquor-light)", color: "var(--liquor-dark)" }}
      aria-hidden="true"
    >
      {initials(testimonial.name)}
    </div>
  );
}

/** Managed entirely through the Admin Panel CMS — this component just renders whatever the
 *  public GET returns (already filtered to `isPublished`, see LandingPageContentController).
 *  Cards use the same `--radius-lg`/`--shadow-sm` bordered-surface treatment as every other
 *  card on this page and in the authenticated app, inside a full-width band with a centered
 *  heading. */
export default function Testimonials({ testimonials }: { testimonials: LandingTestimonial[] }) {
  // No `id="insights"` here on purpose — LandingNav only shows the "Insights" link once this
  // list is non-empty, so nothing ever links to this spacer. Rendered (rather than null) so
  // the loud MetricsStrip/FinalCta bands on either side still get a neutral breathing gap.
  if (testimonials.length === 0) return <div className="h-10 sm:h-14" style={{ background: "var(--surface)" }} aria-hidden="true" />;
  const sorted = [...testimonials].sort((a, b) => a.order - b.order);

  return (
    <section id="insights" className="py-16 sm:py-20" style={{ background: "var(--surface)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal className="max-w-2xl mx-auto text-center mb-10">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
            Trusted Across The Auction
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "var(--text-strong)", fontSize: "clamp(24px, 3vw, 34px)" }}>
            What the floor is saying
          </h2>
        </Reveal>
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {sorted.map((t, i) => (
            <Reveal key={t.id} delay={Math.min(i, 6) * 0.06}>
              <div
                className="rounded-[var(--radius-lg)] border border-border p-6"
                style={{ background: "var(--surface-alt)" }}
              >
                <p className="font-display italic leading-relaxed m-0 mb-4" style={{ color: "var(--text)", fontSize: "15px" }}>
                  &ldquo;{t.quote}&rdquo;
                </p>
                <div className="flex items-center gap-3">
                  <Avatar testimonial={t} />
                  <div>
                    <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
                      {t.name}
                    </p>
                    <p className="text-[11.5px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                      {t.role}
                    </p>
                  </div>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
