"use client";

import ModuleTile from "@/components/home/ModuleTile";
import type { NavItem } from "@/components/shell/nav";
import PageHeader from "@/components/shared/PageHeader";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import ScheduleOutlinedIcon from "@mui/icons-material/ScheduleOutlined";
import SellOutlinedIcon from "@mui/icons-material/SellOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import SummarizeOutlinedIcon from "@mui/icons-material/SummarizeOutlined";
import DonutLargeOutlinedIcon from "@mui/icons-material/DonutLargeOutlined";
import ShareOutlinedIcon from "@mui/icons-material/ShareOutlined";
import NewspaperOutlinedIcon from "@mui/icons-material/NewspaperOutlined";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import BookmarkBorderOutlinedIcon from "@mui/icons-material/BookmarkBorderOutlined";

// Sub-destinations of Reports, not top-level modules — a local tile array rather than
// NAV_ITEMS/nav.ts (which is the global launchpad). No `image` on the not-yet-built tiles:
// ModuleTile's Unsplash-photo convention requires each URL individually verified before
// wiring in (see nav.ts's own comment), and the gradient+icon fallback already reads fine.
//
// Phase 9 (IA consolidation): Broker Comparison, Performance and Saved Reports were each
// their own top-level Intelligence/Library tile — all three are reporting destinations at
// heart, so they're folded in here as their own sub-categories (real routes unchanged,
// still directly reachable, from the command palette, and from the footer nav — see each
// one's `hiddenFromGrid` note in nav.ts). "Modern Reports" groups everything built directly
// for this platform, as distinct from those three pre-existing standalone reports.
const MODERN_REPORT_TILES: NavItem[] = [
  {
    href: "/reports/summary",
    label: "Executive & Summary Reports",
    section: "Reports",
    status: "live",
    description: "Executive, broker, grade, category, garden, classification and valuation summaries.",
    icon: SummarizeOutlinedIcon,
    gradient: 8,
  },
  {
    href: "/reports/combined",
    label: "Top Price Reports",
    section: "Reports",
    status: "live",
    description: "Top Prices, CTC, Off Grades & Dust, Low Grown and Premium Flowery — ranked against every broker.",
    icon: EmojiEventsOutlinedIcon,
    gradient: 6,
  },
  {
    href: "/reports/worksheet",
    label: "Worksheet",
    section: "Reports",
    status: "live",
    description: "Fast, spreadsheet-style pre-auction pricing — a rough working copy, not saved to sale data.",
    icon: DescriptionOutlinedIcon,
    gradient: 2,
  },
  {
    href: "/reports/asking-price",
    label: "Asking Price",
    section: "Reports",
    status: "live",
    description: "Same fast worksheet, for pre-auction asking prices instead of valuations.",
    icon: SellOutlinedIcon,
    gradient: 3,
  },
  {
    href: "/reports/weekly-fact",
    label: "Weekly FACT Reports",
    section: "Reports",
    status: "live",
    description: "UVA/WESTERN High & Medium + LOW rank/mark-wise workbooks, from the CBAS release + factory workbook.",
    icon: FactCheckOutlinedIcon,
    gradient: 4,
  },
  {
    href: "/reports/top-price-page",
    label: "Top Price Page",
    section: "Reports",
    status: "live",
    description: "Every ranked region combined into one executive bulletin — matches the original's exact Excel layout. The interactive editor (themes, manual data entry, image uploads) is still to come.",
    icon: AutoStoriesOutlinedIcon,
    gradient: 7,
  },
  {
    href: "/reports/factory-sale-summary",
    label: "Factory Sale Summary",
    section: "Reports",
    status: "live",
    description: "Estate-wise and Owner/Plantation-group-wise QTY, AVG and unsold breakdown across every broker in a sale.",
    icon: Inventory2OutlinedIcon,
    gradient: 5,
  },
  {
    href: "/reports/category-analysis",
    label: "Category Analysis",
    section: "Reports",
    status: "live",
    description: "Price & Classification, Sale x Broker — any catalogue category, broker distribution, sold/outsold/unsold, and Select Best/Best/Below Best/Poor price tiers.",
    icon: DonutLargeOutlinedIcon,
    gradient: 6,
  },
  {
    href: "/reports/market-bulletin",
    label: "Weekly Market Grade Classification/Quotation",
    section: "Reports",
    status: "live",
    description: "Select Best/Best/Below Best/Poor price-tier ranges per grade, this sale vs last, replicating the printed market bulletin.",
    icon: NewspaperOutlinedIcon,
    gradient: 3,
  },
  {
    href: "/reports/shared-mark-catalogue-summary",
    label: "Sharing Mark Catalogued Summary",
    section: "Reports",
    status: "live",
    description: "Every estate ASC shares with another broker — catalogued Sale/MTD/YTD quantity per side, from the 8 broker pre-sale files, before the sale even happens.",
    icon: ShareOutlinedIcon,
    gradient: 7,
  },
  {
    href: "/reports/automated",
    label: "Automated Reports",
    section: "Reports",
    status: "live",
    description: "Reports that generate themselves on schedule or on sale close — enable, run now, or download outputs.",
    icon: ScheduleOutlinedIcon,
    gradient: 8,
  },
];

// Same tile shape, icon and gradient as each page's own nav.ts entry — this is a second
// entry point to the exact same route, not a rebuild.
const BROKER_COMPARISON_TILES: NavItem[] = [
  {
    href: "/broker",
    label: "Broker Comparison",
    section: "Reports",
    status: "live",
    description: "Rankings, market share and average valuation across brokers.",
    icon: CompareArrowsOutlinedIcon,
    gradient: 4,
    image: "https://images.unsplash.com/photo-1758519288905-38b7b00c1023",
  },
];

const PERFORMANCE_TILES: NavItem[] = [
  {
    href: "/performance",
    label: "Performance",
    section: "Reports",
    status: "live",
    description: "Cross-sale grade valuation streaks and buyer purchase-volume trends.",
    icon: TrendingUpOutlinedIcon,
    gradient: 2,
  },
];

const SAVED_REPORTS_TILES: NavItem[] = [
  {
    href: "/saved-reports",
    label: "Saved Reports",
    section: "Reports",
    status: "live",
    description: "Every report you've saved, ready to reopen.",
    icon: BookmarkBorderOutlinedIcon,
    gradient: 6,
    image: "https://images.unsplash.com/photo-1562240020-ce31ccb0fa7d",
  },
];

/** One labeled sub-category grid — same heading style every other page in this app uses
 *  for a section ("Group Breakdown", "Insights", ...), so the Reports hub's four
 *  sub-categories read as one consistent page, not four different ones stitched together. */
function ReportGroup({ title, subtitle, tiles, priority }: { title: string; subtitle: string; tiles: NavItem[]; priority?: boolean }) {
  return (
    <section className="mb-8">
      <div className="flex items-baseline gap-2.5 mb-3">
        <h4 className="font-display text-[15px] font-semibold text-text-strong m-0">{title}</h4>
        <span className="text-[12px] text-text-muted">{subtitle}</span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {tiles.map((item, i) => (
          <ModuleTile key={item.href} item={item} priority={priority && i < 4} />
        ))}
      </div>
    </section>
  );
}

export default function ReportsLaunchpadPage() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Executive summaries, cross-broker rankings, and everything else built from sale data." />
      <ReportGroup
        title="Modern Reports"
        subtitle="Built directly for this platform, ready to export"
        tiles={MODERN_REPORT_TILES}
        priority
      />
      <ReportGroup
        title="Broker Comparison Reports"
        subtitle="Rankings, market share and average valuation"
        tiles={BROKER_COMPARISON_TILES}
      />
      <ReportGroup
        title="Performance"
        subtitle="Cross-sale grade and buyer trends"
        tiles={PERFORMANCE_TILES}
      />
      <ReportGroup
        title="Saved Reports"
        subtitle="Every report you've saved, ready to reopen"
        tiles={SAVED_REPORTS_TILES}
      />
    </div>
  );
}
