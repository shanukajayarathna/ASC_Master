"use client";

import ModuleTile from "@/components/home/ModuleTile";
import type { NavItem } from "@/components/shell/nav";
import PageHeader from "@/components/shared/PageHeader";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import EmojiEventsOutlinedIcon from "@mui/icons-material/EmojiEventsOutlined";
import FactCheckOutlinedIcon from "@mui/icons-material/FactCheckOutlined";
import AutoStoriesOutlinedIcon from "@mui/icons-material/AutoStoriesOutlined";
import SellOutlinedIcon from "@mui/icons-material/SellOutlined";
import SummarizeOutlinedIcon from "@mui/icons-material/SummarizeOutlined";

// Sub-destinations of Reports, not top-level modules — a local tile array rather than
// NAV_ITEMS/nav.ts (which is the global launchpad). No `image` on the not-yet-built tiles:
// ModuleTile's Unsplash-photo convention requires each URL individually verified before
// wiring in (see nav.ts's own comment), and the gradient+icon fallback already reads fine.
const REPORT_TILES: NavItem[] = [
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
    label: "Combined Report",
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
    status: "soon",
    description: "Same fast worksheet, for pre-auction asking prices instead of valuations.",
    icon: SellOutlinedIcon,
    gradient: 3,
  },
  {
    href: "/reports/weekly-fact",
    label: "Weekly FACT Reports",
    section: "Reports",
    status: "soon",
    description: "UVA/WESTERN High & Medium ranking workbooks, from the CBAS release + factory workbook.",
    icon: FactCheckOutlinedIcon,
    gradient: 4,
  },
  {
    href: "/reports/studio",
    label: "Report Studio",
    section: "Reports",
    status: "soon",
    description: "The editable executive bulletin — themes, sections, images, saved templates.",
    icon: AutoStoriesOutlinedIcon,
    gradient: 7,
  },
];

export default function ReportsLaunchpadPage() {
  return (
    <div>
      <PageHeader title="Reports" subtitle="Executive summaries, cross-broker rankings, and everything else built from sale data." />
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {REPORT_TILES.map((item, i) => (
          <ModuleTile key={item.href} item={item} priority={i < 4} />
        ))}
      </div>
    </div>
  );
}
