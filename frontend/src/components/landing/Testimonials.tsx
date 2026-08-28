import type { LandingTestimonial } from "@/types/api";

/** Managed entirely through the Admin Panel CMS — this component just renders whatever the
 *  public GET returns (already filtered to `isPublished`, see LandingPageContentController).
 *  Cards use the same `--radius-lg`/`--shadow-sm` bordered-surface treatment as every other
 *  card on this page and in the authenticated app, inside a full-width band with a centered
 *  heading. */
export default function Testimonials({ testimonials }: { testimonials: LandingTestimonial[] }) {
  if (testimonials.length === 0) return null;
  const sorted = [...testimonials].sort((a, b) => a.order - b.order);

  return (
    <section id="insights" className="py-16 sm:py-20" style={{ background: "var(--surface)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center mb-10">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
            Trusted Across The Auction
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "var(--text-strong)", fontSize: "clamp(24px, 3vw, 34px)" }}>
            What the floor is saying
          </h2>
        </div>
        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
          {sorted.map((t) => (
            <div
              key={t.id}
              className="rounded-[var(--radius-lg)] border border-border p-6"
              style={{ background: "var(--surface-alt)" }}
            >
              <p className="font-display italic leading-relaxed m-0 mb-4" style={{ color: "var(--text)", fontSize: "15px" }}>
                &ldquo;{t.quote}&rdquo;
              </p>
              <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
                {t.name}
              </p>
              <p className="text-[11.5px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                {t.role}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
