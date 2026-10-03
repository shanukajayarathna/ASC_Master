"use client";

import BrandLogo from "@/components/shell/BrandLogo";
import ThemeMenu from "@/components/shell/ThemeMenu";
import { useAuth } from "@/context/AuthContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import { api } from "@/lib/api";
import type { AppNotification } from "@/types/api";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import RadioButtonCheckedIcon from "@mui/icons-material/RadioButtonChecked";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import NotificationsNoneOutlinedIcon from "@mui/icons-material/NotificationsNoneOutlined";
import SearchIcon from "@mui/icons-material/Search";
import Menu from "@mui/material/Menu";
import Popover from "@mui/material/Popover";
import { AccountSection, AppearanceSection, LanguageSection } from "@/components/settings/SettingsSections";
import MenuItem from "@mui/material/MenuItem";
import SalePicker from "@/components/shared/SalePicker";
import OkloFreshness from "@/components/shared/OkloFreshness";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import Avatar from "@mui/material/Avatar";
import Badge from "@mui/material/Badge";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";

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
      <Popover
        anchorEl={anchor}
        open={!!anchor}
        onClose={close}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{ paper: { sx: { width: 440, maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 90px)", p: 2 } } }}
      >
        <div className="mb-3 px-1">
          <div className="text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>{user.displayName}</div>
          <div className="text-[12px]" style={{ color: "var(--text-muted)" }}>{user.email} · {roleLabel(user.roles)}</div>
        </div>
        <AppearanceSection />
        <LanguageSection />
        <AccountSection />
        <Divider sx={{ my: 1.5 }} />
        <Button
          fullWidth
          variant="outlined"
          color="inherit"
          onClick={() => {
            close();
            logout();
          }}
        >
          Log out
        </Button>
      </Popover>
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

/** True once a sale is open for bidding on OKLO right now - checked on mount and every 2 minutes (the sale list's own
 *  refresh window), so the pulsing dot never lags more than that behind reality. */
function LiveAuctionButton() {
  const [live, setLive] = useState(false);
  useEffect(() => {
    let cancelled = false;
    const check = () => api.getLiveSale().then((r) => { if (!cancelled) setLive(r.live); }).catch(() => {});
    check();
    const timer = setInterval(check, 120_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
  return (
    <Tooltip title={live ? "A sale is open for bidding right now - watch it live" : "Watch the next live auction here"}>
      <Link
        href="/live-auction"
        className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[12px] font-semibold no-underline transition-colors shrink-0"
        style={
          live
            ? { borderColor: "var(--danger, #b3261e)", color: "var(--danger, #b3261e)", background: "var(--danger-light, #fde3e3)" }
            : { borderColor: "var(--border)", color: "var(--text-muted)", background: "var(--surface)" }
        }
      >
        <RadioButtonCheckedIcon sx={{ fontSize: 13 }} className={live ? "animate-pulse" : undefined} />
        {live ? "Live Auction" : "Watch Live"}
      </Link>
    </Tooltip>
  );
}

const PAGES_WITH_OWN_SALE_PICKER = ["/catalogue", "/reports/top-price-page", "/reports/worksheet", "/assistant"];

export default function Topbar({ onSearchClick }: TopbarProps) {
  const { mode } = useThemeMode();
  // These pages have a sale selection in their own workspace controls.
  const pathname = usePathname();
  const showSalePicker = !PAGES_WITH_OWN_SALE_PICKER.some((p) => (pathname ?? "").startsWith(p));
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;

  // Published as --topbar-height so sticky page headers (PageHeader) know exactly how far
  // down to sit — the topbar's own height varies (it wraps to a second row on narrow
  // viewports), so a hardcoded offset would either gap or overlap depending on screen size.
  const headerRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      document.documentElement.style.setProperty("--topbar-height", `${entry.target.getBoundingClientRect().height}px`);
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <header
      ref={headerRef}
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
              Intelligence
            </span>
            <span className="font-mono text-[9.5px] tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
              Hub
            </span>
          </span>
        </Link>
      </Tooltip>

      <LiveAuctionButton />

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

      {/* Two-step sale picker — year first, then the sale on file for that year — rather than
          one long flat list of every sale ever imported. On phones it drops to its own
          full-width row (order-last + wrap) rather than disappearing — switching the active
          sale must stay possible on every device. */}
      {showSalePicker && (
      <SalePicker className="order-last w-full sm:order-none flex gap-1.5 sm:w-[220px] lg:w-[280px] min-w-0" />
      )}

      <div className="flex items-center gap-1 ml-auto">
        <Tooltip title="Ask ASC AI">
          <IconButton component={Link} href="/assistant" size="small" aria-label="AI Assistant">
            <AutoAwesomeOutlinedIcon fontSize="small" />
          </IconButton>
        </Tooltip>

        <OkloFreshness className="hidden lg:inline text-[11.5px] font-mono text-text-muted" />
        <NotificationsMenu />

        {isAdmin && (
          <Tooltip title="Admin Panel">
            <IconButton component={Link} href="/admin" size="small" aria-label="Admin Panel">
              <AdminPanelSettingsOutlinedIcon fontSize="small" sx={{ color: "var(--brand-gold-deep)" }} />
            </IconButton>
          </Tooltip>
        )}

        <ThemeMenu />

        <UserMenu />
      </div>
    </header>
  );
}
