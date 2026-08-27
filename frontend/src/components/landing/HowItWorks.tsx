const STEPS = [
  { n: "01", title: "Upload", body: "A weekly sale catalogue or a document lands in the system — no manual re-keying." },
  { n: "02", title: "AI extracts & values", body: "Lots are structured and valued automatically, grounded in real historical and current-season data." },
  { n: "03", title: "Insights surface", body: "Trends, comparisons and anomalies surface on their own, across every module." },
  { n: "04", title: "Reports auto-generate", body: "Executive, broker and grade reports are ready to export the moment the sale closes." },
];

/**
 * How the platform works — static process strip, not part of the CMS content model. Same
 * bordered/divided-column strip the dashboard's own glance bar uses, rather than a bespoke
 * numbered-stepper layout.
 */
export default function HowItWorks() {
  return (
    <div id="platform" className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <h2 className="font-display text-[15px] font-semibold m-0 mb-3" style={{ color: "var(--text-strong)" }}>
        From catalogue to insight, in one flow
      </h2>
      <div
        className="rounded-[var(--radius-lg)] border border-border grid"
        style={{ background: "var(--surface)", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
      >
        {STEPS.map((step, i) => (
          <div key={step.n} className="p-4" style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}>
            <span className="font-mono text-[12px]" style={{ color: "var(--liquor)" }}>
              {step.n}
            </span>
            <h3 className="font-display text-[14px] font-semibold m-0 mt-1 mb-1" style={{ color: "var(--text-strong)" }}>
              {step.title}
            </h3>
            <p className="text-[12.5px] leading-snug m-0" style={{ color: "var(--text-muted)" }}>
              {step.body}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
