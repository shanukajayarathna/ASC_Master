"use client";

import { useAuth } from "@/context/AuthContext";
import { useThemeMode } from "@/context/ThemeModeContext";
import { api, ApiError } from "@/lib/api";
import type { AuthUser } from "@/types/api";
import DarkModeOutlinedIcon from "@mui/icons-material/DarkModeOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import LightModeOutlinedIcon from "@mui/icons-material/LightModeOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import { useEffect, useState } from "react";

function SettingsSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <section className="mb-8 max-w-2xl">
      <h2 className="font-display text-[15px] font-semibold text-text-strong m-0 mb-1">{title}</h2>
      {subtitle && <p className="text-[12.5px] text-text-muted m-0 mb-3">{subtitle}</p>}
      <div className="border border-border rounded-lg bg-surface p-4">{children}</div>
    </section>
  );
}

function AppearanceSection() {
  const { mode, toggle } = useThemeMode();
  return (
    <SettingsSection title="Appearance" subtitle="Applies everywhere in the app, including this toggle in the top bar.">
      <div className="flex items-center gap-3">
        <Button
          variant={mode === "light" ? "contained" : "outlined"}
          size="small"
          startIcon={<LightModeOutlinedIcon fontSize="small" />}
          onClick={() => mode === "dark" && toggle()}
        >
          Light
        </Button>
        <Button
          variant={mode === "dark" ? "contained" : "outlined"}
          size="small"
          startIcon={<DarkModeOutlinedIcon fontSize="small" />}
          onClick={() => mode === "light" && toggle()}
        >
          Dark
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
        <Button type="submit" variant="contained" disabled={submitting} sx={{ alignSelf: "flex-start" }}>
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
          <CircularProgress size={20} sx={{ color: "var(--liquor)" }} />
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
            <Button type="submit" variant="contained" disabled={addBusy}>
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
          <Button variant="contained" color="error" onClick={confirmDelete} disabled={deleteBusy}>
            {deleteBusy ? "Removing…" : "Remove"}
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
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-text-strong m-0 mb-1">Settings</h1>
        <p className="text-[13px] text-text-muted m-0">Account, appearance and workspace access.</p>
      </div>

      <AppearanceSection />
      <AccountSection />
      {isAdmin && <UsersSection />}
    </div>
  );
}
