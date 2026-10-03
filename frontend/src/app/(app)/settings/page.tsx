"use client";

import PageHeader from "@/components/shared/PageHeader";
import { AccountSection, AppearanceSection, LanguageSection } from "@/components/settings/SettingsSections";
import { useAuth } from "@/context/AuthContext";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import Link from "next/link";

/** Users, API keys, webhooks, master data, audit log and system files moved to the Admin
 *  Panel (/admin) — this is just a pointer for anyone with the Admin role landing here out
 *  of habit; the sections themselves are gone from Settings, not merely hidden. */
function AdminPointer() {
  return (
    <Link
      href="/admin"
      className="mb-8 flex items-center gap-3 p-4 rounded-[var(--radius-lg)] border no-underline transition-colors"
      style={{ borderColor: "var(--liquor)", background: "var(--liquor-light)" }}
    >
      <AdminPanelSettingsOutlinedIcon fontSize="small" sx={{ color: "var(--liquor-dark)" }} />
      <span className="text-[13px] font-semibold" style={{ color: "var(--liquor-dark)" }}>
        Users, API Keys, Webhooks, Master Data and system files moved to the Admin Panel.
      </span>
    </Link>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Your account, appearance and language." />

      {isAdmin && <AdminPointer />}
      <AppearanceSection />
      <LanguageSection />
      <AccountSection />
    </div>
  );
}
