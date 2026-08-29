"use client";

import Reveal from "@/components/landing/motion/Reveal";

const STEPS = [
  { n: "01", title: "Upload", body: "A weekly sale catalogue or a document lands in the system — no manual re-keying." },
  { n: "02", title: "AI extracts & values", body: "Lots are structured and valued automatically, grounded in real historical and current-season data." },
  { n: "03", title: "Insights surface", body: "Trends, comparisons and anomalies surface on their own, across every module." },
  { n: "04", title: "Reports auto-generate", body: "Executive, broker and grade reports are ready to export the moment the sale closes." },
];

/**
 * How the platform works — static process strip, not part of the CMS content model. A
 * full-width band with a centered heading, a supporting banner photo, and a divided-column
 * step strip underneath, the standard "process" beat on a landing page. The banner reuses the
 * same licensed Wikimedia Commons grading/macro shot the login page's TeaCinematic already
 * vetted (see public/tea/intro/ATTRIBUTION.md) — its own scene description is literally
 * "grading / tea-becomes-data", a close match for this section's AI-extraction copy.
 */
export default function HowItWorks() {
  return (
    <section id="how-it-works" className="py-16 sm:py-20" style={{ background: "var(--surface-alt)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <Reveal className="max-w-2xl mx-auto text-center mb-10">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
            How It Works
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "var(--text-strong)", fontSize: "clamp(24px, 3vw, 34px)" }}>
            From catalogue to insight, in one flow
          </h2>
        </Reveal>
        <Reveal
          className="relative aspect-[21/9] sm:aspect-[3/1] rounded-[var(--radius-xl)] overflow-hidden mb-6"
          style={{ boxShadow: "var(--shadow-lg)" }}
        >
          <div
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: "url(/tea/intro/ceylon-tea-grading-macro.webp)" }}
            role="img"
            aria-label="Tea grading photograph"
          />
          <div
            className="absolute inset-0"
            aria-hidden="true"
            style={{ background: "linear-gradient(180deg, transparent 55%, rgba(15,20,16,0.4) 100%)" }}
          />
        </Reveal>
        <div
          className="rounded-[var(--radius-lg)] border border-border grid"
          style={{ background: "var(--surface)", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}
        >
          {STEPS.map((step, i) => (
            <Reveal key={step.n} delay={i * 0.1} className="p-5" style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}>
              <span className="font-mono text-[13px]" style={{ color: "var(--liquor)" }}>
                {step.n}
              </span>
              <h3 className="font-display text-[15px] font-semibold m-0 mt-1.5 mb-1.5" style={{ color: "var(--text-strong)" }}>
                {step.title}
              </h3>
              <p className="text-[13px] leading-snug m-0" style={{ color: "var(--text-muted)" }}>
                {step.body}
              </p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
