import ScrollReveal from "@/components/landing/ScrollReveal";
import type { LandingIntelligenceItem } from "@/types/api";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import RequestQuoteOutlinedIcon from "@mui/icons-material/RequestQuoteOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

// Same icon-per-concept mapping the internal app already uses for these five modules
// (Catalogue/Data Import, Valuation Centre, Knowledge Base, Market Intelligence, AI
// Assistant — see components/shell/nav.ts) so the public page and the product it's selling
// read as the same visual language.
const ICONS: Record<string, SvgIconComponent> = {
  document: Inventory2OutlinedIcon,
  valuation: RequestQuoteOutlinedIcon,
  knowledge: MenuBookOutlinedIcon,
  market: PublicOutlinedIcon,
  assistant: AutoAwesomeOutlinedIcon,
};

const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"];

/**
 * The "5 Intelligences" showcase — editorial grid (roman numeral + title + one sentence +
 * icon), not a generic feature-icon grid. Hover reveal is pure CSS (no JS, no mock
 * screenshot asset to fabricate) so it stays within the motion budget.
 */
export default function FiveIntelligences({ items }: { items: LandingIntelligenceItem[] }) {
  const sorted = [...items].sort((a, b) => a.order - b.order);

  return (
    <section id="intelligence" className="py-20 sm:py-28" style={{ background: "var(--tea-ink)" }}>
      <div className="max-w-7xl mx-auto px-5 sm:px-8">
        <ScrollReveal className="max-w-2xl mb-14">
          <p className="font-mono text-[11px] tracking-[0.24em] uppercase mb-4" style={{ color: "var(--brand-gold-soft)" }}>
            The Platform
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "#FFFDF7", fontSize: "clamp(30px, 4vw, 48px)" }}>
            Five intelligences, one workspace.
          </h2>
        </ScrollReveal>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-px" style={{ background: "rgba(244,241,230,0.12)" }}>
          {sorted.map((item, i) => {
            const Icon = ICONS[item.iconKey] ?? AutoAwesomeOutlinedIcon;
            return (
              <ScrollReveal key={item.title} className="group">
                <div
                  className="h-full p-6 sm:p-7 transition-colors duration-300 group-hover:bg-white/[0.04]"
                  style={{ background: "var(--tea-ink)" }}
                >
                  <span className="font-display text-[13px] font-semibold" style={{ color: "var(--tea-liquor)" }}>
                    {ROMAN[i] ?? i + 1}
                  </span>
                  <div className="mt-5 mb-4 flex items-center justify-between">
                    <Icon sx={{ fontSize: 26, color: "var(--brand-gold-soft)" }} />
                    <span
                      className="w-8 h-px transition-all duration-300 group-hover:w-14"
                      style={{ background: "var(--tea-liquor)" }}
                      aria-hidden="true"
                    />
                  </div>
                  <h3 className="font-display text-[17px] font-semibold m-0 mb-2" style={{ color: "#FFFDF7" }}>
                    {item.title}
                  </h3>
                  <p className="text-[13px] leading-relaxed m-0" style={{ color: "rgba(244,241,230,0.72)" }}>
                    {item.description}
                  </p>
                </div>
              </ScrollReveal>
            );
          })}
        </div>
      </div>
    </section>
  );
}
