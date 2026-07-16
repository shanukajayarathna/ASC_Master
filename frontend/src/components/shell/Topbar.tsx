"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useCatalogue } from "@/context/CatalogueContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import Avatar from "@mui/material/Avatar";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";

interface TopbarProps {
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
}

export default function Topbar({ sidebarCollapsed, onMenuClick }: TopbarProps) {
  const { mode, toggle } = useThemeMode();
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  return (
    <header className="h-[60px] flex items-center gap-3.5 px-5 border-b border-border bg-surface sticky top-0 z-20">
      <Tooltip title="Toggle sidebar">
        <IconButton onClick={onMenuClick} size="small" edge="start" aria-label="Toggle sidebar">
          <MenuIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {/* Brand stays visible whenever the sidebar (and its logo) is out of view:
          always on mobile, and on desktop while the sidebar is collapsed. */}
      <BrandLogo
        height={30}
        onDark={mode === "dark"}
        className={`shrink-0 ${sidebarCollapsed ? "" : "md:!hidden"}`}
      />
      <div className="flex-1 min-w-0">
        <Select
          size="small"
          value={activeCatalogueId ?? ""}
          onChange={(e) => selectCatalogue(e.target.value || null)}
          displayEmpty
          sx={{ minWidth: 260, fontSize: 13 }}
          renderValue={(v) => {
            if (!v) return <span className="text-text-muted">No catalogue loaded</span>;
            const c = catalogues.find((x) => x.id === v);
            return c ? `${c.sourceName} · ${c.rowCount.toLocaleString()} lots` : "…";
          }}
        >
          {catalogues.length === 0 && (
            <MenuItem value="" disabled>
              No catalogues imported yet
            </MenuItem>
          )}
          {catalogues.map((c) => (
            <MenuItem key={c.id} value={c.id}>
              {c.sourceName} · {c.rowCount.toLocaleString()} lots
            </MenuItem>
          ))}
        </Select>
      </div>

      <Tooltip title={mode === "dark" ? "Switch to light mode" : "Switch to dark mode"}>
        <IconButton onClick={toggle} size="small">
          {mode === "dark" ? <LightModeOutlinedIcon fontSize="small" /> : <DarkModeOutlinedIcon fontSize="small" />}
        </IconButton>
      </Tooltip>

      <Avatar sx={{ width: 30, height: 30, bgcolor: "var(--liquor)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
        SJ
      </Avatar>
    </header>
  );
}
