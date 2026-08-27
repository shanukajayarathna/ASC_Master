import type { LandingCompanyStats } from "@/types/api";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";

const CORE_VALUES = ["Morality", "Etiquette", "Public Welfare", "Assurance", "Honor", "Clarity", "Esteem", "Proficiency"];

/**
 * About Asia Siyaka Commodities — company credibility section, built from the real, sourced
 * facts in the CMS (founding year, industry ranking, market share, employee/warehouse counts,
 * vision/mission — see LandingPageContentSeed for provenance), not invented placeholder
 * numbers. Same bordered `--surface` panel + KPI-strip pattern the dashboard's own glance bar
 * uses (divided columns, `font-mono` numbers) rather than a bespoke stat layout. Core values
 * are a fixed, unlikely-to-change corporate list, kept static here rather than added to the
 * CMS schema for a handful of words.
 */
export default function AboutSection({ stats }: { stats: LandingCompanyStats }) {
  const items = [
    { label: "Founded", value: String(stats.foundedYear) },
    { label: "Years Operating", value: `${stats.yearsOperating}+` },
    { label: "Employees", value: `${stats.employeeCount}+` },
    { label: "Warehouses", value: String(stats.warehouseCount) },
  ];

  return (
    <div id="about" className="max-w-7xl mx-auto px-4 sm:px-6 mt-6">
      <div className="rounded-[var(--radius-lg)] border border-border p-5 sm:p-6" style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}>
        <div className="flex items-center gap-2 mb-1">
          <EmojiEventsOutlinedIcon sx={{ fontSize: 16, color: "var(--liquor)" }} />
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase m-0" style={{ color: "var(--liquor)" }}>
            About Asia Siyaka Commodities · {stats.ranking}
          </p>
        </div>
        <h2 className="font-display text-[20px] sm:text-[22px] font-semibold m-0 mb-2" style={{ color: "var(--text-strong)" }}>
          A brokerage built on decades of Colombo auction trust.
        </h2>
        <p className="text-[13.5px] leading-relaxed m-0 mb-1" style={{ color: "var(--text-muted)" }}>
          {stats.marketShareLabel}. Asia Siyaka owns and operates the world&rsquo;s only
          LEED-certified &ldquo;green&rdquo; tea auction logistics center, and is the leading
          tea auction logistics provider in Sri Lanka.
        </p>
        <p className="text-[13px] leading-relaxed italic m-0 mb-5" style={{ color: "var(--text-muted)" }}>
          &ldquo;{stats.mission}&rdquo;
        </p>

        <div className="mb-5 rounded-[var(--radius-lg)] border border-border grid" style={{ background: "var(--surface-alt)", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))" }}>
          {items.map((s, i) => (
            <div key={s.label} className="p-3.5" style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}>
              <div className="font-mono text-[19px] font-semibold leading-tight" style={{ color: "var(--text-strong)" }}>
                {s.value}
              </div>
              <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>
                {s.label}
              </div>
            </div>
          ))}
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
      </div>
    </div>
  );
}
