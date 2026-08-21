"use client";

import RecentActivityList, { type ActivityEntry } from "@/components/home/RecentActivityList";
import { NAV_ITEMS } from "@/components/shell/nav";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { AdminAssetStatus, AuditLogEntry, AuthUser, CatalogueSummary, MslStatus, ApiKeySummary, WebhookSummary } from "@/types/api";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import CableOutlinedIcon from "@mui/icons-material/CableOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ErrorOutlineOutlinedIcon from "@mui/icons-material/ErrorOutlineOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import PeopleAltOutlinedIcon from "@mui/icons-material/PeopleAltOutlined";
import StorageOutlinedIcon from "@mui/icons-material/StorageOutlined";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
import Skeleton from "@mui/material/Skeleton";
import Link from "next/link";
import { useEffect, useState } from "react";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

interface OversightCard {
  key: string;
  icon: typeof PeopleAltOutlinedIcon;
  label: string;
  value: string;
  sub: string;
  href: string;
  warn?: boolean;
}

/** One clickable stat card, styled the same way this app already treats a Link-as-card
 *  (see the Continue Valuing / old Admin shortcut blocks the regular dashboard used —
 *  `lift-on-hover` is a shared class, not invented for this page). */
function OversightTile({ card }: { card: OversightCard }) {
  const Icon = card.icon;
  return (
    <Link
      href={card.href}
      className="flex items-start gap-2.5 p-4 rounded-[var(--radius-lg)] border no-underline lift-on-hover"
      style={{
        background: "var(--surface)",
        borderColor: card.warn ? "var(--warn)" : "var(--border)",
      }}
    >
      <span
        className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
        style={{ background: card.warn ? "var(--warn-light)" : "var(--liquor-light)" }}
      >
        <Icon sx={{ fontSize: 18, color: card.warn ? "var(--warn)" : "var(--liquor)" }} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
          {card.label}
        </div>
        <div className="font-mono text-[19px] font-semibold leading-tight" style={{ color: "var(--text-strong)" }}>
          {card.value}
        </div>
        <div className="text-[10.5px] truncate" style={{ color: card.warn ? "var(--warn)" : "var(--text-muted)" }}>
          {card.sub}
        </div>
      </div>
    </Link>
  );
}

/**
 * The Admin's landing page — an operations control center rather than the regular tile
 * launchpad. Leads with oversight signals (users, sale/MSL data freshness, pending issues,
 * recent audit activity), each card deep-linking into the matching Admin Panel section
 * (/admin#id — see SectionCard's `id` prop). The day-to-day tools every user gets are still
 * reachable below, just de-emphasized: an admin doing real valuation work shouldn't have to
 * leave this page to find Catalogue Manager, just not have it be the first thing they see.
 */
export default function AdminDashboard({ user }: { user: AuthUser }) {
  const [users, setUsers] = useState<AuthUser[] | null>(null);
  const [catalogues, setCatalogues] = useState<CatalogueSummary[] | null>(null);
  const [mslStatus, setMslStatus] = useState<MslStatus | null>(null);
  const [assets, setAssets] = useState<AdminAssetStatus[] | null>(null);
  const [apiKeys, setApiKeys] = useState<ApiKeySummary[] | null>(null);
  const [webhooks, setWebhooks] = useState<WebhookSummary[] | null>(null);
  const [auditEntries, setAuditEntries] = useState<AuditLogEntry[] | null>(null);

  useEffect(() => {
    api.listUsers().then(setUsers).catch(() => setUsers([]));
    api.listCatalogues().then(setCatalogues).catch(() => setCatalogues([]));
    api.mslStatus().then(setMslStatus).catch(() => {});
    api.listAdminAssets().then(setAssets).catch(() => setAssets([]));
    api.listApiKeys().then(setApiKeys).catch(() => setApiKeys([]));
    api.listWebhooks().then(setWebhooks).catch(() => setWebhooks([]));
    api.listAuditLog(0, 6).then(setAuditEntries).catch(() => setAuditEntries([]));
  }, []);

  const loading = users === null || catalogues === null || assets === null || apiKeys === null || webhooks === null;

  const cards: OversightCard[] = [];
  if (users) {
    const admins = users.filter((u) => u.roles.includes("Admin")).length;
    cards.push({ key: "users", icon: PeopleAltOutlinedIcon, label: "Users", value: String(users.length), sub: `${admins} admin${admins === 1 ? "" : "s"}`, href: "/admin#users" });
  }
  if (catalogues) {
    const latest = [...catalogues].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime())[0];
    cards.push({
      key: "sales",
      icon: Inventory2OutlinedIcon,
      label: "Sales Loaded",
      value: String(catalogues.length),
      sub: latest ? `latest ${timeAgo(latest.importedAt)}` : "none yet",
      href: "/admin#sales",
    });
  }
  if (mslStatus) {
    cards.push({
      key: "msl",
      icon: StorageOutlinedIcon,
      label: "MSL Archive",
      value: mslStatus.totalLots.toLocaleString(),
      sub: mslStatus.filesWithErrors > 0 ? `${mslStatus.filesWithErrors} file(s) with errors` : `${mslStatus.trackedFiles} files tracked`,
      href: "/admin#msl",
      warn: mslStatus.filesWithErrors > 0,
    });
  }
  if (assets) {
    const custom = assets.filter((a) => a.hasOverride).length;
    cards.push({ key: "files", icon: CloudUploadOutlinedIcon, label: "System Files", value: String(custom), sub: `${assets.length - custom} using defaults`, href: "/admin#files" });
  }
  if (apiKeys) {
    cards.push({ key: "apikeys", icon: VpnKeyOutlinedIcon, label: "API Keys", value: String(apiKeys.length), sub: "external tool credentials", href: "/admin#apikeys" });
  }
  if (webhooks) {
    cards.push({ key: "webhooks", icon: CableOutlinedIcon, label: "Webhooks", value: String(webhooks.length), sub: "outbound event hooks", href: "/admin#webhooks" });
  }

  // Only real, cheaply-known issues — no fabricated "all good" filler when there's nothing
  // to flag (same principle the regular dashboard's AiInsightsPanel/AttentionList follow).
  const attentionItems: { key: string; text: string; href: string }[] = [];
  if (mslStatus && mslStatus.filesWithErrors > 0) {
    attentionItems.push({
      key: "msl-errors",
      text: `${mslStatus.filesWithErrors} MSL file${mslStatus.filesWithErrors === 1 ? "" : "s"} failed to import — check the MSL Archive section.`,
      href: "/admin#msl",
    });
  }
  if (mslStatus && !mslStatus.lastScanAt) {
    attentionItems.push({ key: "msl-never-scanned", text: "The MSL archive has never been scanned.", href: "/admin#msl" });
  }

  const activity: ActivityEntry[] = (auditEntries ?? []).map((e) => ({
    key: e.id,
    icon: HistoryOutlinedIcon,
    iconColor: "var(--liquor)",
    iconBg: "var(--liquor-light)",
    title: e.action,
    subtitle: e.details ?? e.entityType ?? (e.userEmail ?? "—"),
    timestamp: timeAgo(e.timestamp),
    href: "/admin#audit",
  }));

  // The regular tools every signed-in user gets — kept reachable but visually secondary,
  // since an admin still does real day-to-day work here (per user request: not oversight-only).
  const secondaryTools = NAV_ITEMS.filter((item) => !item.adminOnly && item.href !== "/dashboard");

  return (
    <div>
      <div className="mb-6 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold mb-2"
            style={{ background: "var(--tile-gradient-4)", color: "#fff" }}
          >
            <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 14 }} />
            Administrator
          </div>
          <h1 className="font-display text-[26px] font-bold m-0 mb-1" style={{ color: "var(--text-strong)" }}>
            {greeting()}, {user.displayName.split(" ")[0]}
          </h1>
          <p className="text-[13.5px] m-0" style={{ color: "var(--text-muted)" }}>
            Users, data and the system&apos;s shared files — everything below links into the Admin Panel.
          </p>
        </div>
        <Link
          href="/admin"
          className="flex items-center gap-2 px-4 py-2.5 rounded-[var(--radius-md)] no-underline font-semibold text-[13px]"
          style={{ background: "var(--liquor)", color: "#fff" }}
        >
          Open Admin Panel
          <ArrowForwardIcon sx={{ fontSize: 16 }} />
        </Link>
      </div>

      {loading ? (
        <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} variant="rounded" height={82} sx={{ borderRadius: "var(--radius-lg)" }} />
          ))}
        </div>
      ) : (
        <div className="mb-6 grid gap-3" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          {cards.map((c) => (
            <OversightTile key={c.key} card={c} />
          ))}
        </div>
      )}

      {attentionItems.length > 0 && (
        <div className="mb-6 flex flex-col gap-2">
          {attentionItems.map((a) => (
            <Link
              key={a.key}
              href={a.href}
              className="flex items-center gap-3 p-3.5 rounded-[var(--radius-lg)] border no-underline lift-on-hover"
              style={{ borderColor: "var(--warn)", background: "var(--warn-light)" }}
            >
              <ErrorOutlineOutlinedIcon sx={{ fontSize: 18, color: "var(--warn)" }} />
              <span className="flex-1 text-[12.5px]" style={{ color: "var(--text-strong)" }}>
                {a.text}
              </span>
              <ArrowForwardIcon sx={{ fontSize: 16, color: "var(--text-muted)" }} />
            </Link>
          ))}
        </div>
      )}

      <div className="mb-6" style={{ maxWidth: 560 }}>
        <RecentActivityList entries={activity} />
      </div>

      <div className="pt-4 border-t border-border">
        <h2 className="font-display text-[13px] font-semibold m-0 mb-3" style={{ color: "var(--text-muted)" }}>
          Day-to-day tools
        </h2>
        <div className="flex flex-wrap gap-2">
          {secondaryTools.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-border text-[12px] no-underline"
                style={{ color: "var(--text)", background: "var(--surface)" }}
              >
                <Icon sx={{ fontSize: 15, color: "var(--text-muted)" }} />
                {item.label}
              </Link>
            );
          })}
        </div>
      </div>

      <div className="text-center pt-6 mt-6 border-t border-border">
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          ASC — Tea Auction Valuation &amp; Business Intelligence Platform
        </p>
        <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
          © {new Date().getFullYear()} Asia Siyaka Commodities PLC. All rights reserved.
        </p>
      </div>
    </div>
  );
}
