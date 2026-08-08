"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useAuth } from "@/context/AuthContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import { api, ApiError } from "@/lib/api";
import type { ApiKeySummary, AuthUser, WebhookSummary } from "@/types/api";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import SettingsBrightnessOutlinedIcon from "@mui/icons-material/SettingsBrightnessOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import FormControlLabel from "@mui/material/FormControlLabel";
import IconButton from "@mui/material/IconButton";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useState } from "react";

function SettingsSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8">
      <h2 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-1">{title}</h2>
      {subtitle && <p className="text-[12.5px] text-text-muted m-0 mb-3">{subtitle}</p>}
      <div className="border border-border rounded-lg bg-surface p-4">{children}</div>
    </section>
  );
}

function AppearanceSection() {
  const { preference, setPreference } = useThemeMode();
  return (
    <SettingsSection title="Appearance" subtitle="Applies everywhere in the app, including this toggle in the top bar.">
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
    </SettingsSection>
  );
}

function AccountSection() {
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
    <SettingsSection title="Account" subtitle={user ? `${user.displayName} · ${user.email}` : undefined}>
      <form onSubmit={submit} className="flex flex-col gap-3 max-w-sm">
        {error && <div className="p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}
        {success && (
          <div className="p-2.5 rounded border border-sage bg-sage-light text-[12.5px]" style={{ color: "var(--sage-dark)" }}>
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
    </SettingsSection>
  );
}

const ROLE_LABELS: Record<string, string> = { Admin: "Admin", User: "User" };

function UsersSection() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState<AuthUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addEmail, setAddEmail] = useState("");
  const [addName, setAddName] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AuthUser | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    api
      .listUsers()
      .then(setUsers)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load users"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const changeRole = async (id: string, role: "Admin" | "User") => {
    setError(null);
    try {
      const updated = await api.setUserRole(id, role);
      setUsers((list) => list.map((u) => (u.id === id ? updated : u)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change that user's role");
    }
  };

  const addUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    try {
      await api.register(addEmail.trim(), addPassword, addName.trim());
      setAddOpen(false);
      setAddEmail("");
      setAddName("");
      setAddPassword("");
      refresh();
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "Couldn't create the account");
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteUser(deleteTarget.id);
      setUsers((list) => list.filter((u) => u.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete that user");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <SettingsSection title="Users" subtitle="Everyone with access to this workspace.">
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}

      <div className="flex justify-end mb-3">
        <Button variant="outlined" size="small" startIcon={<PersonAddOutlinedIcon fontSize="small" />} onClick={() => setAddOpen(true)}>
          Add User
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Email</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Role</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Since</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{u.displayName}</td>
                  <td className="px-2 py-2 text-text-muted">{u.email}</td>
                  <td className="px-2 py-2">
                    <Select
                      size="small"
                      value={u.roles[0] ?? "User"}
                      onChange={(e) => changeRole(u.id, e.target.value as "Admin" | "User")}
                      sx={{ fontSize: 13, minWidth: 100 }}
                    >
                      <MenuItem value="Admin">{ROLE_LABELS.Admin}</MenuItem>
                      <MenuItem value="User">{ROLE_LABELS.User}</MenuItem>
                    </Select>
                  </td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-2 text-right">
                    <Button
                      size="small"
                      color="error"
                      startIcon={<DeleteOutlineIcon fontSize="small" />}
                      onClick={() => setDeleteTarget(u)}
                      disabled={u.id === currentUser?.id}
                    >
                      Remove
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addOpen} onClose={() => (addBusy ? null : setAddOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Add User</DialogTitle>
        <form onSubmit={addUser}>
          <DialogContent>
            {addError && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{addError}</div>}
            <div className="flex flex-col gap-3">
              <TextField
                label="Display name"
                size="small"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                size="small"
                value={addEmail}
                onChange={(e) => setAddEmail(e.target.value)}
                required
                fullWidth
              />
              <TextField
                label="Temporary password"
                type="password"
                size="small"
                value={addPassword}
                onChange={(e) => setAddPassword(e.target.value)}
                helperText="At least 8 characters — they can change it from Settings once logged in."
                required
                fullWidth
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)} disabled={addBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={addBusy} aria-busy={addBusy}>
              {addBusy ? "Creating…" : "Create Account"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => (deleteBusy ? null : setDeleteTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Remove User</DialogTitle>
        <DialogContent>
          <p className="text-[13px] text-text m-0">
            Remove <strong>{deleteTarget?.displayName}</strong> ({deleteTarget?.email})? They&apos;ll lose access immediately. This can&apos;t be
            undone.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={deleteBusy} aria-busy={deleteBusy}>
            {deleteBusy ? "Removing…" : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSection>
  );
}

/** Shows a freshly created secret exactly once (an API key's raw value, a webhook's signing
 *  secret) — the app never stores or re-displays it after this, same principle as a GitHub
 *  personal access token. Shared by ApiKeysSection and WebhooksSection since the UI is
 *  identical; only the surrounding create-flow (and the fields being created) differs. */
function RevealSecretDialog({ open, title, value, onClose }: { open: boolean; title: string; value: string | null; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(true);
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 0.5 }}>{title}</DialogTitle>
      <DialogContent>
        <p className="text-[12.5px] text-danger m-0 mb-3">Copy this now — for security, it won&apos;t be shown again.</p>
        <div className="flex items-center gap-2 p-2.5 rounded border border-border bg-surface-sunken">
          <code className="flex-1 text-[12.5px] font-mono break-all">{value}</code>
          <Tooltip title={copied ? "Copied" : "Copy"}>
            <IconButton size="small" onClick={copy} aria-label="Copy to clipboard">
              {copied ? (
                <CheckCircleOutlinedIcon fontSize="small" sx={{ color: "var(--sage-dark)" }} />
              ) : (
                <ContentCopyOutlinedIcon fontSize="small" />
              )}
            </IconButton>
          </Tooltip>
        </div>
      </DialogContent>
      <DialogActions>
        <Button variant="contained" onClick={onClose}>
          Done
        </Button>
      </DialogActions>
    </Dialog>
  );
}

const API_KEY_ROLE_OPTIONS: ("Admin" | "User")[] = ["User", "Admin"];

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRoles, setAddRoles] = useState<("Admin" | "User")[]>(["User"]);
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [revealKey, setRevealKey] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ApiKeySummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    api
      .listApiKeys()
      .then(setKeys)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load API keys"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const toggleRole = (role: "Admin" | "User") => {
    setAddRoles((prev) => (prev.includes(role) ? prev.filter((r) => r !== role) : [...prev, role]));
  };

  const addKey = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await api.createApiKey(addName.trim(), addRoles);
      setAddOpen(false);
      setAddName("");
      setAddRoles(["User"]);
      refresh();
      setRevealKey(created.rawKey);
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "Couldn't create the API key");
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteApiKey(deleteTarget.id);
      setKeys((list) => list.filter((k) => k.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't revoke that key");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <SettingsSection title="API Keys" subtitle="Credentials for external tools (e.g. an n8n workflow) to call this API without a human login.">
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}

      <div className="flex justify-end mb-3">
        <Button variant="outlined" size="small" startIcon={<AddOutlinedIcon fontSize="small" />} onClick={() => setAddOpen(true)}>
          New Key
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : keys.length === 0 ? (
        <p className="text-[12.5px] text-text-muted m-0">No API keys yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Key</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Roles</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Last Used</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{k.name}</td>
                  <td className="px-2 py-2 font-mono text-[11.5px] text-text-muted">{k.keyPrefix}…</td>
                  <td className="px-2 py-2 text-text-muted">{k.roles.join(", ")}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">
                    {k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : "Never"}
                  </td>
                  <td className="px-2 py-2 text-right">
                    <Button size="small" color="error" startIcon={<DeleteOutlineIcon fontSize="small" />} onClick={() => setDeleteTarget(k)}>
                      Revoke
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addOpen} onClose={() => (addBusy ? null : setAddOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>New API Key</DialogTitle>
        <form onSubmit={addKey}>
          <DialogContent>
            {addError && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{addError}</div>}
            <div className="flex flex-col gap-3">
              <TextField
                label="Name"
                size="small"
                placeholder="e.g. n8n — sale notifications"
                value={addName}
                onChange={(e) => setAddName(e.target.value)}
                autoFocus
                required
                fullWidth
              />
              <div>
                <p className="text-[11.5px] text-text-muted m-0 mb-1">Roles</p>
                {API_KEY_ROLE_OPTIONS.map((role) => (
                  <FormControlLabel
                    key={role}
                    control={<Checkbox size="small" checked={addRoles.includes(role)} onChange={() => toggleRole(role)} />}
                    label={role}
                  />
                ))}
              </div>
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)} disabled={addBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={addBusy || addRoles.length === 0} aria-busy={addBusy}>
              {addBusy ? "Creating…" : "Create Key"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <RevealSecretDialog open={!!revealKey} title="API Key Created" value={revealKey} onClose={() => setRevealKey(null)} />

      <Dialog open={!!deleteTarget} onClose={() => (deleteBusy ? null : setDeleteTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Revoke API Key</DialogTitle>
        <DialogContent>
          <p className="text-[13px] text-text m-0">
            Revoke <strong>{deleteTarget?.name}</strong>? Any tool using it will lose access immediately. This can&apos;t be undone.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={deleteBusy} aria-busy={deleteBusy}>
            {deleteBusy ? "Revoking…" : "Revoke"}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSection>
  );
}

function WebhooksSection() {
  const [webhooks, setWebhooks] = useState<WebhookSummary[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addUrl, setAddUrl] = useState("");
  const [addEvent, setAddEvent] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [revealSecret, setRevealSecret] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<WebhookSummary | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    api
      .listWebhooks()
      .then(setWebhooks)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load webhooks"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    api
      .listWebhookEvents()
      .then((list) => {
        setEvents(list);
        setAddEvent(list[0] ?? "");
      })
      .catch(() => {});
  }, []);

  const addWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddBusy(true);
    setAddError(null);
    try {
      const created = await api.createWebhook(addUrl.trim(), addEvent);
      setAddOpen(false);
      setAddUrl("");
      refresh();
      setRevealSecret(created.secret);
    } catch (e) {
      setAddError(e instanceof ApiError ? e.message : "Couldn't create the webhook");
    } finally {
      setAddBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteWebhook(deleteTarget.id);
      setWebhooks((list) => list.filter((w) => w.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete that webhook");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <SettingsSection title="Webhooks" subtitle="Notify an external tool (e.g. n8n) when something happens in this app.">
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}

      <div className="flex justify-end mb-3">
        <Button variant="outlined" size="small" startIcon={<AddOutlinedIcon fontSize="small" />} onClick={() => setAddOpen(true)}>
          New Webhook
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : webhooks.length === 0 ? (
        <p className="text-[12.5px] text-text-muted m-0">No webhooks yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Event</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">URL</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Since</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {webhooks.map((w) => (
                <tr key={w.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-mono text-[11.5px]">{w.event}</td>
                  <td className="px-2 py-2 text-text-muted truncate max-w-[520px]">{w.url}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{new Date(w.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-2 text-right">
                    <Button size="small" color="error" startIcon={<DeleteOutlineIcon fontSize="small" />} onClick={() => setDeleteTarget(w)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={addOpen} onClose={() => (addBusy ? null : setAddOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>New Webhook</DialogTitle>
        <form onSubmit={addWebhook}>
          <DialogContent>
            {addError && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{addError}</div>}
            <div className="flex flex-col gap-3">
              <Select size="small" value={addEvent} onChange={(e) => setAddEvent(e.target.value)} fullWidth>
                {events.map((ev) => (
                  <MenuItem key={ev} value={ev}>
                    {ev}
                  </MenuItem>
                ))}
              </Select>
              <TextField
                label="Target URL"
                size="small"
                placeholder="https://your-n8n-instance/webhook/…"
                helperText="Must start with http:// or https://"
                value={addUrl}
                onChange={(e) => setAddUrl(e.target.value)}
                required
                fullWidth
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setAddOpen(false)} disabled={addBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={addBusy || !addEvent} aria-busy={addBusy}>
              {addBusy ? "Creating…" : "Create Webhook"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <RevealSecretDialog open={!!revealSecret} title="Webhook Created" value={revealSecret} onClose={() => setRevealSecret(null)} />

      <Dialog open={!!deleteTarget} onClose={() => (deleteBusy ? null : setDeleteTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Delete Webhook</DialogTitle>
        <DialogContent>
          <p className="text-[13px] text-text m-0">
            Delete the webhook for <strong>{deleteTarget?.event}</strong>? This can&apos;t be undone.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
            Cancel
          </Button>
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={deleteBusy} aria-busy={deleteBusy}>
            {deleteBusy ? "Deleting…" : "Delete"}
          </Button>
        </DialogActions>
      </Dialog>
    </SettingsSection>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;

  return (
    <div>
      <PageHeader title="Settings" subtitle="Account, appearance and workspace access." />

      <AppearanceSection />
      <AccountSection />
      {isAdmin && <UsersSection />}
      {isAdmin && <ApiKeysSection />}
      {isAdmin && <WebhooksSection />}
    </div>
  );
}
