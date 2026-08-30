"use client";

import Reveal from "@/components/landing/motion/Reveal";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

const STEPS: { n: string; title: string; body: string; icon: SvgIconComponent }[] = [
  { n: "01", title: "Upload", body: "A weekly sale catalogue or a document lands in the system — no manual re-keying.", icon: CloudUploadOutlinedIcon },
  { n: "02", title: "AI extracts & values", body: "Lots are structured and valued automatically, grounded in real historical and current-season data.", icon: AutoAwesomeOutlinedIcon },
  { n: "03", title: "Insights surface", body: "Trends, comparisons and anomalies surface on their own, across every module.", icon: InsightsOutlinedIcon },
  { n: "04", title: "Reports auto-generate", body: "Executive, broker and grade reports are ready to export the moment the sale closes.", icon: DescriptionOutlinedIcon },
];

/**
 * How the platform works — static process strip, not part of the CMS content model. A
 * full-width band with a centered heading, a supporting banner photo, and a divided-column
 * step strip underneath, the standard "process" beat on a landing page. The banner is a
 * sorting/grading room (crated, numbered machine stations) rather than a loose-leaf macro shot
 * — it reads as organized/systematic, a closer visual match for a software-workflow strip (see
 * public/tea/intro/ATTRIBUTION.md). Each step also carries a small icon badge, the same
 * icon-in-circle treatment FiveIntelligences uses, so this strip reads as the same product
 * rather than a generic marketing "process" template.
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
            style={{ backgroundImage: "url(/tea/intro/tea-sorting-grading-room.webp)" }}
            role="img"
            aria-label="Tea sorting and grading room photograph"
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
              <div className="flex items-center justify-between mb-2.5">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
                  style={{ background: "var(--liquor-light)" }}
                >
                  <step.icon sx={{ fontSize: 17 }} style={{ color: "var(--liquor)" }} />
                </div>
                <span className="font-mono text-[13px]" style={{ color: "var(--liquor)" }}>
                  {step.n}
                </span>
              </div>
              <h3 className="font-display text-[15px] font-semibold m-0 mb-1.5" style={{ color: "var(--text-strong)" }}>
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
