export interface NavItem {
  href: string;
  label: string;
  section: string;
  status?: "live" | "soon";
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", section: "Workspace", status: "live" },
  { href: "/catalogue", label: "Catalogue Manager", section: "Workspace", status: "live" },
  { href: "/valuation", label: "Valuation Centre", section: "Workspace", status: "live" },
  { href: "/analysis", label: "Analysis", section: "Intelligence", status: "soon" },
  { href: "/reports", label: "Reports", section: "Intelligence", status: "soon" },
  { href: "/broker", label: "Broker Comparison", section: "Intelligence", status: "soon" },
  { href: "/market", label: "Market Intelligence", section: "Intelligence", status: "soon" },
  { href: "/saved-reports", label: "Saved Reports", section: "Library", status: "soon" },
  { href: "/saved-filters", label: "Saved Filters", section: "Library", status: "soon" },
  { href: "/data-import", label: "Data Import", section: "Library", status: "live" },
  { href: "/exports", label: "Exports", section: "Library", status: "live" },
  { href: "/settings", label: "Settings", section: "System", status: "soon" },
  { href: "/help", label: "Help", section: "System", status: "live" },
];

export const NAV_SECTIONS = ["Workspace", "Intelligence", "Library", "System"];
