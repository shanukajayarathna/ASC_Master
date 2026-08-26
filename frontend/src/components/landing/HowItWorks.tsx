import ScrollReveal from "@/components/landing/ScrollReveal";

const STEPS = [
  { n: "01", title: "Upload", body: "A weekly sale catalogue or a document lands in the system — no manual re-keying." },
  { n: "02", title: "AI extracts & values", body: "Lots are structured and valued automatically, grounded in real historical and current-season data." },
  { n: "03", title: "Insights surface", body: "Trends, comparisons and anomalies surface on their own, across every module." },
  { n: "04", title: "Reports auto-generate", body: "Executive, broker and grade reports are ready to export the moment the sale closes." },
];

/** Static process strip — how the platform actually works, not part of the CMS content model. */
export default function HowItWorks() {
  return (
    <section id="platform" className="py-20 sm:py-28" style={{ background: "var(--tea-ledger)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <ScrollReveal className="max-w-2xl mb-14">
          <p className="font-mono text-[11px] tracking-[0.24em] uppercase mb-4" style={{ color: "var(--tea-liquor)" }}>
            How It Works
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "var(--tea-ink)", fontSize: "clamp(28px, 3.4vw, 44px)" }}>
            From catalogue to insight, in one flow.
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 lg:gap-6">
          {STEPS.map((step, i) => (
            <ScrollReveal key={step.n}>
              <div className="relative pl-0">
                <span className="font-display font-bold block mb-4" style={{ color: "var(--gold-hairline)", fontSize: "48px" }}>
                  {step.n}
                </span>
                <h3 className="font-display text-[17px] font-semibold m-0 mb-2" style={{ color: "var(--tea-ink)" }}>
                  {step.title}
                </h3>
                <p className="text-[13px] leading-relaxed m-0" style={{ color: "var(--tea-leaf)" }}>
                  {step.body}
                </p>
                {i < STEPS.length - 1 && (
                  <span
                    className="hidden lg:block absolute top-6 -right-3 w-6 h-px"
                    style={{ background: "var(--gold-hairline)" }}
                    aria-hidden="true"
                  />
                )}
              </div>
            </ScrollReveal>
          ))}
        </div>
      </div>
    </section>
  );
}
