import type { LandingIntelligenceItem } from "@/types/api";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import RequestQuoteOutlinedIcon from "@mui/icons-material/RequestQuoteOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

// Same icon *and* gradient per concept the internal launchpad already assigns to these exact
// five modules (Catalogue/Data Import, Valuation Centre, Knowledge Base, Market Intelligence,
// AI Assistant — see components/shell/nav.ts / --tile-gradient-*), so this grid reads as more
// of the same product rather than a rebranded feature list.
const ICON: Record<string, SvgIconComponent> = {
  document: Inventory2OutlinedIcon,
  valuation: RequestQuoteOutlinedIcon,
  knowledge: MenuBookOutlinedIcon,
  market: PublicOutlinedIcon,
  assistant: AutoAwesomeOutlinedIcon,
};
const GRADIENT: Record<string, number> = { document: 2, valuation: 6, knowledge: 7, market: 1, assistant: 5 };

/**
 * The "5 Intelligences" showcase, built on the exact same tile shell as the authenticated
 * launchpad's `ModuleTile` (rounded-[var(--radius-xl)] border card, `lift-on-hover`,
 * gradient-header + icon badge, `--shadow-sm`) — no photo per tile (these are capabilities,
 * not literal screens), matching ModuleTile's own designed fallback for tiles with no `image`
 * set. Wrapped in a full-width band with a centered section heading, the standard landing-page
 * "feature grid" beat, rather than a small left-aligned label sitting directly on the page.
 */
export default function FiveIntelligences({ items }: { items: LandingIntelligenceItem[] }) {
  const sorted = [...items].sort((a, b) => a.order - b.order);

  return (
    <section id="intelligence" className="py-16 sm:py-20" style={{ background: "var(--surface)" }}>
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="max-w-2xl mx-auto text-center mb-10 sm:mb-12">
          <p className="font-mono text-[11px] tracking-[0.2em] uppercase mb-3" style={{ color: "var(--liquor)" }}>
            The Platform
          </p>
          <h2 className="font-display font-bold m-0" style={{ color: "var(--text-strong)", fontSize: "clamp(24px, 3vw, 34px)" }}>
            Five intelligences, one workspace
          </h2>
        </div>

        <div className="grid gap-5" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {sorted.map((item) => {
            const Icon = ICON[item.iconKey] ?? AutoAwesomeOutlinedIcon;
            const gradient = GRADIENT[item.iconKey] ?? 1;
            return (
              <div
                key={item.title}
                className="flex flex-col rounded-[var(--radius-xl)] border border-border overflow-hidden lift-on-hover"
                style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
              >
                <div
                  className="h-[100px] flex items-end shrink-0 relative overflow-hidden"
                  style={{ background: `var(--tile-gradient-${gradient})` }}
                >
                  <div
                    className="absolute inset-0"
                    style={{ background: "radial-gradient(120% 140% at 15% 15%, rgba(255,255,255,0.22), transparent 55%)" }}
                    aria-hidden="true"
                  />
                  <div className="relative z-10 p-3">
                    <div className="w-10 h-10 rounded-full flex items-center justify-center" style={{ background: "rgba(255,255,255,0.28)" }}>
                      <Icon sx={{ fontSize: 20, color: "#fff" }} />
                    </div>
                  </div>
                </div>
                <div className="p-4 flex-1 flex flex-col gap-1">
                  <h3 className="font-display text-[15px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
                    {item.title}
                  </h3>
                  <p className="text-[12.5px] leading-snug m-0" style={{ color: "var(--text-muted)" }}>
                    {item.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
