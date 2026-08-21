import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import BookmarkBorderOutlinedIcon from "@mui/icons-material/BookmarkBorderOutlined";
import CloudDownloadOutlinedIcon from "@mui/icons-material/CloudDownloadOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import CompareArrowsOutlinedIcon from "@mui/icons-material/CompareArrowsOutlined";
import FilterAltOutlinedIcon from "@mui/icons-material/FilterAltOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import InsightsOutlinedIcon from "@mui/icons-material/InsightsOutlined";
import ManageSearchOutlinedIcon from "@mui/icons-material/ManageSearchOutlined";
import MenuBookOutlinedIcon from "@mui/icons-material/MenuBookOutlined";
import PublicOutlinedIcon from "@mui/icons-material/PublicOutlined";
import RequestQuoteOutlinedIcon from "@mui/icons-material/RequestQuoteOutlined";
import SpaceDashboardOutlinedIcon from "@mui/icons-material/SpaceDashboardOutlined";
import SummarizeOutlinedIcon from "@mui/icons-material/SummarizeOutlined";
import SupportAgentOutlinedIcon from "@mui/icons-material/SupportAgentOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import TuneOutlinedIcon from "@mui/icons-material/TuneOutlined";
import type { SvgIconComponent } from "@mui/icons-material";

export interface NavItem {
  href: string;
  label: string;
  section: string;
  status?: "live" | "soon";
  /** One line shown on the launchpad tile and (as secondary text) in the command palette. */
  description: string;
  /** The tile's icon (launchpad + command palette). */
  icon: SvgIconComponent;
  /** Which of the eight brand-gradient artwork treatments (--tile-gradient-1..8) this tile
   *  uses — hand-picked per module, spaced out so adjacent tiles in the grid never look
   *  identical, rather than auto-cycled. Doubles as the tile's overlay tint and the
   *  fallback background if `image` is unset or fails to load. */
  gradient: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  /** Unsplash CDN photo base URL (no query string — ModuleTile appends its own sizing
   *  params), verified individually (HTTP 200 + visual check) before being wired in.
   *  Optional: a tile with none falls back to the plain gradient + icon treatment. */
  image?: string;
  /** Hidden from the launchpad grid and command palette for anyone without the Admin role —
   *  checked at each consumption site (dashboard tile grid, CommandPalette), same pattern as
   *  Settings' admin-gated sections. */
  adminOnly?: boolean;
}

export const NAV_ITEMS: NavItem[] = [
  {
    href: "/dashboard",
    label: "Dashboard",
    section: "Workspace",
    status: "live",
    description: "Your home base — KPIs, quick actions and everything else in one place.",
    icon: SpaceDashboardOutlinedIcon,
    gradient: 1,
  },
  {
    href: "/catalogue",
    label: "Catalogue Manager",
    section: "Workspace",
    status: "live",
    description: "Import weekly sale catalogues and browse every lot in the grid.",
    icon: Inventory2OutlinedIcon,
    gradient: 2,
    image: "https://images.unsplash.com/photo-1602943543714-cf535b048440",
  },
  {
    href: "/valuation",
    label: "Valuation Centre",
    section: "Workspace",
    status: "live",
    description: "Value and classify lots — list view or the tablet-friendly focus mode.",
    icon: RequestQuoteOutlinedIcon,
    gradient: 6,
    image: "https://images.unsplash.com/photo-1531967802777-e0f8fc276609",
  },
  {
    href: "/knowledge",
    label: "Knowledge Base",
    section: "Intelligence",
    status: "live",
    description: "Upload circulars, SOPs and policies — searchable by every user.",
    icon: MenuBookOutlinedIcon,
    gradient: 7,
    image: "https://images.unsplash.com/photo-1603058817990-2b9a9abbce86",
  },
  {
    href: "/assistant",
    label: "AI Assistant",
    section: "Intelligence",
    status: "live",
    description: "Ask about lots, valuations and documents — grounded in this sale's data.",
    icon: AutoAwesomeOutlinedIcon,
    gradient: 5,
    image: "https://images.unsplash.com/photo-1644088379091-d574269d422f",
  },
  {
    href: "/analysis",
    label: "Analysis",
    section: "Intelligence",
    status: "live",
    description: "Distribution, breakdowns and data-quality checks for the active sale.",
    icon: InsightsOutlinedIcon,
    gradient: 3,
    image: "https://images.unsplash.com/photo-1666875753105-c63a6f3bdc86",
  },
  {
    href: "/reports",
    label: "Reports",
    section: "Intelligence",
    status: "live",
    description: "Executive, broker, grade and valuation summaries — ready to export.",
    icon: SummarizeOutlinedIcon,
    gradient: 8,
    image: "https://images.unsplash.com/photo-1554224155-1696413565d3",
  },
  {
    href: "/broker",
    label: "Broker Comparison",
    section: "Intelligence",
    status: "live",
    description: "Rankings, market share and average valuation across brokers.",
    icon: CompareArrowsOutlinedIcon,
    gradient: 4,
    image: "https://images.unsplash.com/photo-1758519288905-38b7b00c1023",
  },
  {
    href: "/master-search",
    label: "Master Search",
    section: "Intelligence",
    status: "live",
    description: "Search 13 years of auction history — every lot, price, buyer and estate.",
    icon: ManageSearchOutlinedIcon,
    gradient: 4,
  },
  {
    href: "/market",
    label: "Market Intelligence",
    section: "Intelligence",
    status: "live",
    description: "Compare estimates against actual auction prices — accuracy and insights.",
    icon: PublicOutlinedIcon,
    gradient: 1,
    image: "https://images.unsplash.com/photo-1524661135-423995f22d0b",
  },
  {
    href: "/performance",
    label: "Performance",
    section: "Intelligence",
    status: "live",
    description: "Cross-sale grade valuation streaks and buyer purchase-volume trends.",
    icon: TrendingUpOutlinedIcon,
    gradient: 2,
  },
  {
    href: "/saved-reports",
    label: "Saved Reports",
    section: "Library",
    status: "live",
    description: "Every report you've saved, ready to reopen.",
    icon: BookmarkBorderOutlinedIcon,
    gradient: 6,
    image: "https://images.unsplash.com/photo-1562240020-ce31ccb0fa7d",
  },
  {
    href: "/saved-filters",
    label: "Saved Filters",
    section: "Library",
    status: "live",
    description: "Named Catalogue Manager filter sets — apply one in a click.",
    icon: FilterAltOutlinedIcon,
    gradient: 7,
    image: "https://images.unsplash.com/photo-1544523830-2bef1d330b7d",
  },
  {
    href: "/data-import",
    label: "Data Import",
    section: "Library",
    status: "live",
    description: "Bring in a new sale file or actual post-sale prices.",
    icon: CloudUploadOutlinedIcon,
    gradient: 2,
    image: "https://images.unsplash.com/photo-1667984390538-3dea7a3fe33d",
  },
  {
    href: "/exports",
    label: "Exports",
    section: "Library",
    status: "live",
    description: "Build a custom Excel export from any set of lots.",
    icon: CloudDownloadOutlinedIcon,
    gradient: 5,
    image: "https://images.unsplash.com/photo-1783115259399-3a5a3e0e4592",
  },
  {
    href: "/settings",
    label: "Settings",
    section: "System",
    status: "live",
    description: "Your account, appearance and language.",
    icon: TuneOutlinedIcon,
    gradient: 8,
    image: "https://images.unsplash.com/photo-1563641749712-028dfeab14b3",
  },
  {
    href: "/admin",
    label: "Admin Panel",
    section: "System",
    status: "live",
    description: "Users, roles, API keys, webhooks, master data and system files — full control.",
    icon: AdminPanelSettingsOutlinedIcon,
    gradient: 4,
    // No `image` — unlike the other tiles, deliberately left as the plain gradient + icon
    // treatment rather than wiring in an unverified Unsplash URL (see the `image` doc comment
    // above: every other tile's photo was checked individually before being added).
    adminOnly: true,
  },
  {
    href: "/help",
    label: "Help",
    section: "System",
    status: "live",
    description: "How the platform works, page by page.",
    icon: SupportAgentOutlinedIcon,
    gradient: 3,
    image: "https://images.unsplash.com/photo-1553775282-20af80779df7",
  },
];

export const NAV_SECTIONS = ["Workspace", "Intelligence", "Library", "System"];
