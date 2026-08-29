"use client";

import type { LandingCompanyStats } from "@/types/api";
import CountUp from "@/components/landing/motion/CountUp";
import Reveal from "@/components/landing/motion/Reveal";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";

const CORE_VALUES = ["Morality", "Etiquette", "Public Welfare", "Assurance", "Honor", "Clarity", "Esteem", "Proficiency"];

/**
 * About Asia Siyaka Commodities — company credibility section, built from the real, sourced
 * facts in the CMS (founding year, industry ranking, market share, employee/warehouse counts,
 * vision/mission — see LandingPageContentSeed for provenance), not invented placeholder
 * numbers. A standard "About us" split (copy left, stat grid + values right) on a full-width
 * band, rather than everything nested inside one large bordered card.
 */
export default function AboutSection({ stats }: { stats: LandingCompanyStats }) {
  const items = [
    { label: "Founded", value: String(stats.foundedYear) },
    { label: "Years Operating", value: `${stats.yearsOperating}+` },
    { label: "Employees", value: `${stats.employeeCount}+` },
    { label: "Warehouses", value: String(stats.warehouseCount) },
  ];

  return (
    <section id="about" className="py-16 sm:py-20" style={{ background: "var(--surface)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        <Reveal direction="left">
          <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1.5 rounded-full" style={{ background: "var(--liquor-light)" }}>
            <EmojiEventsOutlinedIcon sx={{ fontSize: 15, color: "var(--liquor)" }} />
            <span className="font-mono text-[10.5px] tracking-wide" style={{ color: "var(--liquor-dark)" }}>
              {stats.ranking}
            </span>
          </div>
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
            About Asia Siyaka Commodities
          </p>
          <h2
            className="font-display font-bold m-0 mb-4"
            style={{ color: "var(--text-strong)", fontSize: "clamp(24px, 3vw, 34px)" }}
          >
            A brokerage built on decades of Colombo auction trust.
          </h2>
          <p className="text-[14.5px] leading-relaxed m-0 mb-4" style={{ color: "var(--text-muted)" }}>
            {stats.marketShareLabel}. Asia Siyaka owns and operates the world&rsquo;s only
            LEED-certified &ldquo;green&rdquo; tea auction logistics center, and is the leading
            tea auction logistics provider in Sri Lanka.
          </p>
          <div className="mb-6">
            <p className="text-[13.5px] leading-relaxed italic m-0" style={{ color: "var(--text-muted)" }}>
              &ldquo;{stats.mission}&rdquo;
            </p>
            {stats.vision && (
              <p className="text-[13.5px] leading-relaxed italic m-0 mt-3" style={{ color: "var(--text-muted)" }}>
                &ldquo;{stats.vision}&rdquo;
              </p>
            )}
          </div>

          <div className="flex items-center gap-1.5 mb-2.5">
            <AutoAwesomeOutlinedIcon sx={{ fontSize: 14, color: "var(--liquor)" }} />
            <span className="text-[12px] font-semibold" style={{ color: "var(--text-strong)" }}>
              Our Values
            </span>
          </div>
          <div className="flex flex-wrap gap-2">
            {CORE_VALUES.map((v) => (
              <span key={v} className="px-3 py-1.5 rounded-full border border-border text-[12px]" style={{ color: "var(--text)", background: "var(--surface-alt)" }}>
                {v}
              </span>
            ))}
          </div>
        </Reveal>

        <div className="grid grid-cols-2 gap-4">
          {items.map((s, i) => (
            <Reveal key={s.label} delay={i * 0.08}>
              <div
                className="rounded-[var(--radius-lg)] border border-border p-5"
                style={{ background: "var(--surface-alt)" }}
              >
                <div className="font-mono font-semibold leading-tight" style={{ color: "var(--liquor-dark)", fontSize: "clamp(26px, 2.6vw, 34px)" }}>
                  <CountUp value={s.value} />
                </div>
                <div className="text-[12.5px] mt-1" style={{ color: "var(--text-muted)" }}>
                  {s.label}
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}
