/**
 * Sets up why the platform exists. Static editorial copy — not part of the CMS content model
 * (Section 5.1 covers hero/stats/intelligences/testimonials/heritage, deliberately not this
 * framing section), so there's nothing here for an Admin to edit.
 */
export default function ProblemSection() {
  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <div
        className="rounded-[var(--radius-lg)] border border-border p-5 sm:p-6"
        style={{ background: "var(--surface)" }}
      >
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase mb-2" style={{ color: "var(--liquor)" }}>
          The Problem
        </p>
        <p className="text-[14px] leading-relaxed m-0 max-w-3xl" style={{ color: "var(--text)" }}>
          Every sale week, catalogues get re-keyed by hand, valuations get built from memory
          and last season&rsquo;s notebook, and reports get assembled overnight. Auction
          intelligence is still a manual craft — this platform exists to make it an instant
          one.
        </p>
      </div>
    </div>
  );
}
