import ScrollReveal from "@/components/landing/ScrollReveal";

/**
 * Sets up why the platform exists. Static editorial copy — not part of the CMS content model
 * (Section 5.1 covers hero/stats/intelligences/testimonials/heritage, deliberately not this
 * framing section), so there's nothing here for an Admin to edit.
 */
export default function ProblemSection() {
  return (
    <section className="py-20 sm:py-28" style={{ background: "var(--tea-ledger)" }}>
      <div className="max-w-4xl mx-auto px-5 sm:px-8 text-center">
        <ScrollReveal>
          <p className="font-mono text-[11px] tracking-[0.24em] uppercase mb-5" style={{ color: "var(--tea-liquor)" }}>
            The Problem
          </p>
          <p
            className="font-display font-semibold leading-snug m-0"
            style={{ color: "var(--tea-ink)", fontSize: "clamp(24px, 3vw, 36px)" }}
          >
            Every sale week, catalogues get re-keyed by hand, valuations get built from memory
            and last season&rsquo;s notebook, and reports get assembled overnight. Auction
            intelligence is still a manual craft — this platform exists to make it an
            instant one.
          </p>
        </ScrollReveal>
      </div>
    </section>
  );
}
