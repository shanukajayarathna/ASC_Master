import type { LandingTestimonial } from "@/types/api";

/** Managed entirely through the Admin Panel CMS — this component just renders whatever the
 *  public GET returns (already filtered to `isPublished`, see LandingPageContentController).
 *  Cards use the same `--radius-lg`/`--shadow-sm` bordered-surface treatment as every other
 *  card on this page and in the authenticated app. */
export default function Testimonials({ testimonials }: { testimonials: LandingTestimonial[] }) {
  if (testimonials.length === 0) return null;
  const sorted = [...testimonials].sort((a, b) => a.order - b.order);

  return (
    <div id="insights" className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <h2 className="font-display text-[15px] font-semibold m-0 mb-3" style={{ color: "var(--text-strong)" }}>
        Trusted across the auction
      </h2>
      <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
        {sorted.map((t) => (
          <div
            key={t.id}
            className="rounded-[var(--radius-lg)] border border-border p-4"
            style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
          >
            <p className="font-display italic leading-relaxed m-0 mb-3" style={{ color: "var(--text)", fontSize: "14px" }}>
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
  );
}
