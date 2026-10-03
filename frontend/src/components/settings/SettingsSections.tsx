"use client";

import SectionCard from "@/components/shared/SectionCard";
import { useAuth } from "@/context/AuthContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import { useUiLang } from "@/lib/i18n";
import { api, ApiError } from "@/lib/api";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import { useState } from "react";

export function AppearanceSection() {
  const { preference, setPreference } = useThemeMode();
  return (
    <SectionCard title="Appearance" subtitle="Applies everywhere in the app, including this toggle in the top bar.">
      <div className="flex items-center gap-3">
        <Button
          variant={preference === "light" ? "contained" : "outlined"}
          size="small"
          startIcon={<LightModeOutlinedIcon fontSize="small" />}
          onClick={() => setPreference("light")}
        >
          Light
        </Button>
        <Button
          variant={preference === "dark" ? "contained" : "outlined"}
          size="small"
          startIcon={<DarkModeOutlinedIcon fontSize="small" />}
          onClick={() => setPreference("dark")}
        >
          Dark
        </Button>
        <Button
          variant={preference === "system" ? "contained" : "outlined"}
          size="small"
          startIcon={<SettingsBrightnessOutlinedIcon fontSize="small" />}
          onClick={() => setPreference("system")}
        >
          System
        </Button>
      </div>
    </SectionCard>
  );
}

/** The ONE UI-language setting (docs/29 multilingual UI) — dashboard labels only, adopted
 *  incrementally across surfaces. AI conversation language is automatic per message and is
 *  deliberately not controlled here. */
export function LanguageSection() {
  const { lang, setLang } = useUiLang();
  return (
    <SectionCard
      title="Language"
      subtitle="Dashboard labels. The AI Assistant detects your language automatically in every message — English, සිංහල, தமிழ் or Singlish."
    >
      <div className="flex items-center gap-3">
        {([["en", "English"], ["si", "සිංහල"], ["ta", "தமிழ்"]] as const).map(([code, label]) => (
          <Button key={code} variant={lang === code ? "contained" : "outlined"} size="small" onClick={() => setLang(code)}>
            {label}
          </Button>
        ))}
      </div>
    </SectionCard>
  );
}

export function AccountSection() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(false);
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    setSubmitting(true);
    try {
      await api.changePassword(currentPassword, newPassword);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setSuccess(true);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change the password");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SectionCard title="Account" subtitle={user ? `${user.displayName} · ${user.email}` : undefined}>
      <form onSubmit={submit} className="flex flex-col gap-3 max-w-sm">
        {error && <div className="p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}
        {success && (
          <div className="p-2.5 rounded-[var(--radius-lg)] border border-sage bg-sage-light text-[13px]" style={{ color: "var(--sage-dark)" }}>
            Password changed.
          </div>
        )}
        <TextField
          label="Current password"
          type="password"
          size="small"
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <TextField
          label="New password"
          type="password"
          size="small"
          value={newPassword}
          onChange={(e) => setNewPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <TextField
          label="Confirm new password"
          type="password"
          size="small"
          value={confirmPassword}
          onChange={(e) => setConfirmPassword(e.target.value)}
          autoComplete="new-password"
          required
        />
        <Button type="submit" variant="contained" disabled={submitting} aria-busy={submitting} sx={{ alignSelf: "flex-start" }}>
          {submitting ? "Changing…" : "Change Password"}
        </Button>
      </form>
    </SectionCard>
  );
}
