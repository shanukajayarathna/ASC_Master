"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import CheckIcon from "@mui/icons-material/Check";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";
import SearchIcon from "@mui/icons-material/Search";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Select from "@mui/material/Select";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
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

/** "Administrator" / "User" from the account's real roles — never fabricated. */
function roleLabel(roles: string[]): string {
  if (roles.includes("Admin")) return "Administrator";
  if (roles.length > 0) return roles[0];
  return "User";
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
      <button
        type="button"
        onClick={open}
        aria-label="Account menu"
        className="flex items-center gap-2 pl-1 pr-2 py-1 rounded-full cursor-pointer border-0 bg-transparent"
      >
        <Avatar sx={{ width: 34, height: 34, bgcolor: "var(--liquor)", fontSize: 13, fontFamily: "var(--font-mono)" }}>
          {initialsOf(user.displayName)}
        </Avatar>
        <span className="hidden md:flex flex-col items-start leading-tight">
          <span className="text-[12.5px] font-semibold" style={{ color: "var(--text-strong)" }}>
            {user.displayName}
          </span>
          <span className="text-[11px]" style={{ color: "var(--text-muted)" }}>
            {roleLabel(user.roles)}
          </span>
        </span>
        <ExpandMoreIcon sx={{ fontSize: 18, color: "var(--text-muted)" }} className="hidden md:block" />
      </button>
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

const THEME_OPTIONS = [
  { value: "light", label: "Light", icon: LightModeOutlinedIcon },
  { value: "dark", label: "Dark", icon: DarkModeOutlinedIcon },
  { value: "system", label: "System", icon: SettingsBrightnessOutlinedIcon },
] as const;

function ThemeMenu() {
  const { mode, preference, setPreference } = useThemeMode();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const CurrentIcon = mode === "dark" ? DarkModeOutlinedIcon : LightModeOutlinedIcon;

  return (
    <>
      <Tooltip title="Theme">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small" aria-label="Change theme">
          <CurrentIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        {THEME_OPTIONS.map((opt) => (
          <MenuItem
            key={opt.value}
            selected={preference === opt.value}
            onClick={() => {
              setPreference(opt.value);
              setAnchor(null);
            }}
          >
            <ListItemIcon>
              <opt.icon fontSize="small" />
            </ListItemIcon>
            <ListItemText>{opt.label}</ListItemText>
            {preference === opt.value && <CheckIcon fontSize="small" sx={{ color: "var(--liquor)", ml: 1 }} />}
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

/** The bell's badge is a real number — lots still pending a valuation in the active sale
 *  (the same `DashboardStats.pending` the launchpad KPIs show) — not a decorative count.
 *  Read from CatalogueContext (shared with the dashboard's own KPIs) rather than fetched
 *  here too — this renders on every page, so an independent fetch here doubled up with the
 *  dashboard's whenever both were mounted at once. */
function NotificationsMenu() {
  const { activeCatalogue, activeStats } = useCatalogue();
  const pending = activeStats?.pending ?? null;
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);

  return (
    <>
      <Tooltip title="Pending valuations">
        <IconButton onClick={(e) => setAnchor(e.currentTarget)} size="small" aria-label="Notifications">
          <Badge badgeContent={pending ?? 0} color="error" max={99} invisible={!pending}>
            <NotificationsNoneOutlinedIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)} anchorOrigin={{ vertical: "bottom", horizontal: "right" }}>
        <MenuItem disabled sx={{ opacity: "1 !important" }}>
          <ListItemText
            primary={pending ? `${pending.toLocaleString()} lot${pending === 1 ? "" : "s"} pending valuation` : "Nothing pending"}
            secondary={activeCatalogue?.sourceName ?? "No active sale"}
          />
        </MenuItem>
        {!!pending && (
          <MenuItem component={Link} href="/valuation" onClick={() => setAnchor(null)}>
            Go to Valuation Centre
          </MenuItem>
        )}
      </Menu>
    </>
  );
}

interface TopbarProps {
  /** Opens the Ctrl/Cmd+K command palette — the search field here is just its trigger. */
  onSearchClick: () => void;
}

export default function Topbar({ onSearchClick }: TopbarProps) {
  const { mode } = useThemeMode();
  const { catalogues, activeCatalogueId, selectCatalogue } = useCatalogue();

  return (
    <header
      className="h-[68px] flex items-center gap-4 px-5 border-b border-border bg-surface sticky top-0 z-20"
      style={{ boxShadow: "var(--shadow-sm)" }}
    >
      <Tooltip title="Home">
        <Link href="/dashboard" className="shrink-0 flex items-center gap-2 rounded-[var(--radius-sm)]">
          <BrandLogo height={30} onDark={mode === "dark"} />
          <span className="hidden lg:flex flex-col leading-none border-l border-border pl-2">
            <span className="font-mono text-[9.5px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Tea Auction
            </span>
            <span className="font-mono text-[9.5px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Platform
            </span>
          </span>
        </Link>
      </Tooltip>

      <button
        type="button"
        onClick={onSearchClick}
        className="flex-1 min-w-0 max-w-[480px] flex items-center gap-2 px-4 py-2 rounded-full border border-border text-left cursor-pointer"
        style={{ background: "var(--surface-alt)", color: "var(--text-muted)" }}
      >
        <SearchIcon fontSize="small" />
        <span className="text-[13px] truncate flex-1">Search lots, brokers, gardens, sales…</span>
        <kbd className="font-mono text-[10.5px] px-1.5 py-0.5 rounded border border-border shrink-0 hidden md:inline">Ctrl + K</kbd>
      </button>

      <div className="hidden sm:block min-w-0 w-[180px] lg:w-[220px]">
        <Select
          size="small"
          value={activeCatalogueId ?? ""}
          onChange={(e) => selectCatalogue(e.target.value || null)}
          displayEmpty
          sx={{ width: "100%", fontSize: 13 }}
          renderValue={(v) => {
            if (!v) return <span className="text-text-muted">No catalogue</span>;
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

      <div className="flex items-center gap-1 ml-auto">
        <Tooltip title="Ask ASC AI">
          <IconButton component={Link} href="/assistant" size="small" aria-label="AI Assistant">
            <AutoAwesomeOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <NotificationsMenu />

        <ThemeMenu />

        <UserMenu />
      </div>
    </header>
  );
}
