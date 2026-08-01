"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import MenuIcon from "@mui/icons-material/Menu";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Select from "@mui/material/Select";
import Avatar from "@mui/material/Avatar";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { useState, type MouseEvent } from "react";

function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

function UserMenu() {
  const { user, logout } = useAuth();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = (e: MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);
  const close = () => setAnchor(null);

  if (!user) {
    return (
      <Button component={Link} href="/login" variant="outlined" size="small" color="primary">
        Log in
      </Button>
    );
  }

  return (
    <>
      <Tooltip title={user.displayName}>
        <IconButton onClick={open} size="small" aria-label="Account menu">
          <Avatar sx={{ width: 30, height: 30, bgcolor: "var(--liquor)", fontSize: 12, fontFamily: "var(--font-mono)" }}>
            {initialsOf(user.displayName)}
          </Avatar>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={close} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <MenuItem disabled sx={{ opacity: "1 !important" }}>
          <ListItemText primary={user.displayName} secondary={user.email} />
        </MenuItem>
        <Divider />
        <MenuItem
          onClick={() => {
            close();
            logout();
          }}
        >
          Log out
        </MenuItem>
      </Menu>
    </>
  );
}

interface TopbarProps {
  sidebarCollapsed: boolean;
  onMenuClick: () => void;
}

export default function Topbar({ sidebarCollapsed, onMenuClick }: TopbarProps) {
  const { mode, toggle } = useThemeMode();
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  return (
    <header
      className="h-[60px] flex items-center gap-3.5 px-5 border-b border-border bg-surface sticky top-0 z-20"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
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
          // Fluid, not a fixed 260px: on a phone the header holds a hamburger, brand,
          // theme toggle and avatar too, so a hard min-width pushed the row wider than
          // the screen and the whole page scrolled sideways. It now fills whatever space
          // is left (truncating its label) and only caps out on wide screens.
          sx={{ width: "100%", maxWidth: 340, minWidth: 0, fontSize: 13 }}
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

      <UserMenu />
    </header>
  );
}
