"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import { api } from "@/lib/api";
import type { AppNotification } from "@/types/api";
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
import { useRouter } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";

function timeAgo(iso: string): string {
  const minutes = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

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

/** A real notification center: the badge is the account's actual unread count (polled every
 *  60s, independent of whatever page is mounted), and opening the bell fetches the real
 *  list — title/body/priority/read-state — rather than a single derived "pending valuations"
 *  number. Deadline reminders (see Modules/Deadlines) are the first real producer; more
 *  notification types are additive from here, nothing here is specific to valuations. */
function NotificationsMenu() {
  const router = useRouter();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const refresh = () => api.getUnreadNotificationCount().then(setUnreadCount).catch(() => {});
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, []);

  const open = (e: MouseEvent<HTMLElement>) => {
    setAnchor(e.currentTarget);
    setLoading(true);
    api
      .listNotifications()
      .then(setNotifications)
      .catch(() => {})
      .finally(() => setLoading(false));
  };

  const close = () => setAnchor(null);

  const handleClick = (n: AppNotification) => {
    if (!n.readAt) {
      const readAt = new Date().toISOString();
      setNotifications((list) => list.map((x) => (x.id === n.id ? { ...x, readAt } : x)));
      setUnreadCount((c) => Math.max(0, c - 1));
      api.markNotificationRead(n.id).catch(() => {});
    }
    close();
    if (n.actionUrl) router.push(n.actionUrl);
  };

  const markAllRead = () => {
    const readAt = new Date().toISOString();
    setNotifications((list) => list.map((n) => ({ ...n, readAt: n.readAt ?? readAt })));
    setUnreadCount(0);
    api.markAllNotificationsRead().catch(() => {});
  };

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={open} size="small" aria-label="Notifications">
          <Badge badgeContent={unreadCount} color="error" max={99} invisible={!unreadCount}>
            <NotificationsNoneOutlinedIcon fontSize="small" />
          </Badge>
        </IconButton>
      </Tooltip>
      <Menu
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: "min(360px, calc(100vw - 32px))", maxHeight: 440 } } }}
      >
        <div className="flex items-center justify-between px-3 py-1.5">
          <span className="text-[11px] font-mono tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
            Notifications
          </span>
          {notifications.some((n) => !n.readAt) && (
            <button
              type="button"
              onClick={markAllRead}
              className="text-[11px] border-0 bg-transparent cursor-pointer p-0"
              style={{ color: "var(--liquor)" }}
            >
              Mark all read
            </button>
          )}
        </div>
        <Divider />
        {loading ? (
          <MenuItem disabled sx={{ opacity: "1 !important" }}>
            <ListItemText primary="Loading…" />
          </MenuItem>
        ) : notifications.length === 0 ? (
          <MenuItem disabled sx={{ opacity: "1 !important" }}>
            <ListItemText primary="Nothing yet" secondary="You're all caught up." />
          </MenuItem>
        ) : (
          notifications.map((n) => (
            <MenuItem key={n.id} onClick={() => handleClick(n)} sx={{ whiteSpace: "normal", alignItems: "flex-start", opacity: n.readAt ? 0.62 : 1 }}>
              <ListItemText
                primary={
                  <span className="flex items-center gap-1.5">
                    {n.priority === "high" && <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: "var(--danger)" }} />}
                    <span className="text-[12.5px] font-medium">{n.title}</span>
                  </span>
                }
                secondary={
                  <span className="flex flex-col gap-0.5 mt-0.5">
                    {n.body && <span className="text-[11.5px] block">{n.body}</span>}
                    <span className="text-[10.5px] font-mono block">{timeAgo(n.createdAt)}</span>
                  </span>
                }
              />
            </MenuItem>
          ))
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
      // Paddings live in .app-topbar (globals.css), not utilities — they fold in the
      // display-cutout safe-area insets for installed/standalone use on notched devices.
      className="app-topbar min-h-[68px] flex items-center gap-x-4 gap-y-2 flex-wrap border-b border-border bg-surface sticky top-0 z-20"
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

      {/* On phones the picker drops to its own full-width row (order-last + wrap) rather
          than disappearing — switching the active sale must stay possible on every device. */}
      <div className="order-last w-full sm:order-none sm:w-[180px] lg:w-[220px] min-w-0">
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
