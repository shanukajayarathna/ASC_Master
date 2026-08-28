/**
 * Sets up why the platform exists. Static editorial copy — not part of the CMS content model
 * (Section 5.1 covers hero/stats/intelligences/testimonials/heritage, deliberately not this
 * framing section), so there's nothing here for an Admin to edit. A plain centered text band,
 * the standard "problem statement" beat between a hero and the feature grid that follows it.
 */
export default function ProblemSection() {
  return (
    <section className="py-14 sm:py-16" style={{ background: "var(--surface-alt)" }}>
      <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
        <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
          The Problem
        </p>
        <p className="font-display text-[19px] sm:text-[22px] leading-snug m-0" style={{ color: "var(--text-strong)" }}>
          Every sale week, catalogues get re-keyed by hand, valuations get built from memory
          and last season&rsquo;s notebook, and reports get assembled overnight. Auction
          intelligence is still a manual craft — this platform exists to make it an instant one.
        </p>
      </div>
    </section>
  );
}
