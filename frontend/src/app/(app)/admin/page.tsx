"use client";

import PageHeader from "@/components/shared/PageHeader";
import SectionCard from "@/components/shared/SectionCard";
import TeaLoader from "@/components/shared/TeaLoader";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, ROLES, roleLabel } from "@/lib/roles";
import type {
  AdminAssetStatus,
  ApiKeySummary,
  AuditLogEntry,
  AuthUser,
  MasterDataEntity,
  MslScanSummary,
  MslStatus,
  UnmappedMasterDataValue,
  WebhookSummary,
} from "@/types/api";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
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
import { useEffect, useMemo, useRef, useState } from "react";

const FILE_GROUP_ORDER = ["FACT Templates", "RANK Templates", "LOW Template", "Market Share Template", "Branding"];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

/** The new piece: report templates (FACT/RANK/LOW/Market Share) and the export letterhead
 *  logo ship baked into the frontend build / data/branding — this lets an Admin replace any
 *  of them on the fly, stored on this server's local disk (see backend Modules/AdminAssets),
 *  with every report-generating page picking up the change on its next run. */
function FilesSection() {
  const [assets, setAssets] = useState<AdminAssetStatus[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busySlot, setBusySlot] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const pendingSlotRef = useRef<string | null>(null);

  const refresh = () => {
    setLoading(true);
    api
      .listAdminAssets()
      .then(setAssets)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load files"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const triggerUpload = (slotId: string) => {
    pendingSlotRef.current = slotId;
    fileInputRef.current?.click();
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const slotId = pendingSlotRef.current;
    e.target.value = ""; // lets the same filename be chosen again later
    if (!file || !slotId) return;
    setError(null);
    setBusySlot(slotId);
    try {
      const updated = await api.uploadAdminAsset(slotId, file);
      setAssets((list) => list.map((a) => (a.id === slotId ? updated : a)));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setBusySlot(null);
    }
  };

  const revert = async (slotId: string) => {
    setError(null);
    setBusySlot(slotId);
    try {
      await api.revertAdminAsset(slotId);
      refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't revert to the default");
    } finally {
      setBusySlot(null);
    }
  };

  const groups = useMemo(
    () =>
      FILE_GROUP_ORDER.map((group) => ({ group, items: assets.filter((a) => a.group === group) })).filter(
        (g) => g.items.length > 0
      ),
    [assets]
  );

  return (
    <SectionCard
      id="files"
      title="System Files"
      subtitle="Report templates and the export logo used across reports and auction workbooks. Upload a replacement to use it everywhere immediately — no redeploy needed. Stored on this server's local disk."
    >
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}
      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.png" onChange={onFileChosen} />

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : (
        <div className="flex flex-col gap-5">
          {groups.map(({ group, items }) => (
            <div key={group}>
              <h3 className="text-[11px] uppercase tracking-widest font-mono text-text-muted m-0 mb-2">{group}</h3>
              <div className="flex flex-col gap-2">
                {items.map((a) => (
                  <div
                    key={a.id}
                    className="flex items-center justify-between gap-3 px-3 py-2.5 rounded border border-border"
                    style={{ background: "var(--surface-sunken)" }}
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium m-0" style={{ color: "var(--text-strong)" }}>
                        {a.label}
                      </p>
                      <p className="text-[11.5px] text-text-muted m-0 truncate">{a.description}</p>
                      <p className="text-[11px] font-mono text-text-muted m-0 mt-0.5">
                        {a.hasOverride
                          ? `Custom · ${formatBytes(a.sizeBytes ?? 0)} · ${a.uploadedAtUtc ? new Date(a.uploadedAtUtc).toLocaleString() : "—"}${a.uploadedBy ? ` · ${a.uploadedBy}` : ""}`
                          : "Using bundled default"}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      {a.hasOverride && (
                        <Button size="small" color="error" onClick={() => revert(a.id)} disabled={busySlot === a.id}>
                          Revert
                        </Button>
                      )}
                      <Button
                        size="small"
                        variant="outlined"
                        startIcon={<CloudUploadOutlinedIcon fontSize="small" />}
                        onClick={() => triggerUpload(a.id)}
                        disabled={busySlot === a.id}
                      >
                        {busySlot === a.id ? "Uploading…" : a.hasOverride ? "Replace" : "Upload"}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </SectionCard>
  );
}

/** Weekly sale catalogue files (data/sales/*.xlsx) — the same import CataloguesController
 *  already exposes at /catalogue, just reachable from the Admin Panel too. Uses the shared
 *  CatalogueContext (mounted for every (app) page) rather than a separate fetch, so this
 *  list is never out of sync with what the rest of the app sees. Uploading with `select:
 *  false` deliberately doesn't switch anyone's active sale — an admin replacing sale 12 from
 *  here shouldn't yank another tab's Catalogue Manager over to it. */
function SalesDataSection() {
  const { catalogues, importFile, importing, error: importError } = useCatalogue();
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    try {
      await importFile(file, { select: false });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    }
  };

  return (
    <SectionCard
      id="sales"
      title="Sales Catalogue Files"
      subtitle="Weekly sale files (data/sales/*.xlsx). Upload a numbered file (e.g. 31.xlsx) to add a sale, or re-upload the same number to replace it — anything else imports as the next sale. There's no delete here: removing a sale means deleting its Excel file from data/sales directly."
    >
      {(error || importError) && (
        <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error ?? importError}</div>
      )}
      <input ref={fileInputRef} type="file" className="hidden" accept=".xlsx,.xls" onChange={onFileChosen} />
      <div className="flex justify-end mb-3">
        <Button
          variant="outlined"
          size="small"
          startIcon={<CloudUploadOutlinedIcon fontSize="small" />}
          onClick={() => fileInputRef.current?.click()}
          disabled={importing}
        >
          {importing ? "Importing…" : "Import Sale File"}
        </Button>
      </div>
      {catalogues.length === 0 ? (
        <p className="text-[12.5px] text-text-muted m-0">No sales loaded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Sale</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Lots</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Imported</th>
              </tr>
            </thead>
            <tbody>
              {catalogues.map((c) => (
                <tr key={c.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{c.sourceName}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{c.rowCount.toLocaleString()}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{new Date(c.importedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </SectionCard>
  );
}

type MslUploadType = "auction" | "private" | "teaboard";

/** The MSL archive (data/msl/ — 637 sales of historical auction/private-sale/Tea Board data,
 *  see data/msl/README.md). The folder watcher auto-imports on change, so this is the same
 *  "drop the file in the right place" routine the README documents, just done as an upload
 *  instead of a filesystem copy — see MslController.Upload for the exact placement rules. */
function MslDataSection() {
  const [status, setStatus] = useState<MslStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [uploadType, setUploadType] = useState<MslUploadType>("auction");
  const [year, setYear] = useState("");
  const [saleNo, setSaleNo] = useState("");
  const [month, setMonth] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadResult, setUploadResult] = useState<MslScanSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [rescanBusy, setRescanBusy] = useState(false);

  const refresh = () => {
    setLoading(true);
    api
      .mslStatus()
      .then(setStatus)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load MSL status"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const rescan = async (force: boolean) => {
    setError(null);
    setRescanBusy(true);
    try {
      const summary = await api.mslRescan(force);
      setUploadResult(summary);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Rescan failed");
    } finally {
      setRescanBusy(false);
    }
  };

  const onFileChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setError(null);
    setUploadResult(null);
    setUploadBusy(true);
    try {
      const summary = await api.uploadMslFile(uploadType, file, {
        year: year ? Number(year) : undefined,
        saleNo: saleNo ? Number(saleNo) : undefined,
        month: month ? Number(month) : undefined,
      });
      setUploadResult(summary);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploadBusy(false);
    }
  };

  const fieldsValid =
    uploadType === "auction" ? year.trim() !== "" && saleNo.trim() !== "" :
    uploadType === "teaboard" ? year.trim() !== "" && month.trim() !== "" :
    true; // private sale only needs the file

  return (
    <SectionCard
      id="msl"
      title="MSL Archive"
      subtitle="Historical Colombo tea-auction data (data/msl/) — auction sale broker files, private-sale files and Tea Board monthly reports. An upload is placed exactly where data/msl/README.md's manual routine puts it, then scanned immediately."
    >
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : status ? (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
            {[
              { label: "Total Lots", value: status.totalLots.toLocaleString() },
              { label: "Private Lots", value: status.privateLots.toLocaleString() },
              { label: "Tracked Files", value: status.trackedFiles.toLocaleString() },
              { label: "Files w/ Errors", value: status.filesWithErrors.toLocaleString() },
              { label: "Tea Board Months", value: status.teaBoardMonths.toLocaleString() },
            ].map((s) => (
              <div key={s.label} className="rounded border border-border p-3" style={{ background: "var(--surface-sunken)" }}>
                <p className="font-display text-lg font-bold m-0" style={{ color: "var(--text-strong)" }}>
                  {s.value}
                </p>
                <p className="text-[11px] text-text-muted m-0">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="text-[11.5px] text-text-muted m-0 mb-3">
            Last scan: {status.lastScanAt ? new Date(status.lastScanAt).toLocaleString() : "never"}
            {status.lastScan && ` · ${status.lastScan.filesImported} file(s) imported, ${status.lastScan.rowsImported.toLocaleString()} row(s), ${status.lastScan.filesRemoved} removed`}
          </p>

          {status.years.length > 0 && (
            <div className="overflow-x-auto mb-4">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-2 font-medium text-text-muted">Year</th>
                    <th className="text-left px-2 py-2 font-medium text-text-muted">Sales</th>
                    <th className="text-left px-2 py-2 font-medium text-text-muted">Lots</th>
                  </tr>
                </thead>
                <tbody>
                  {status.years.map((y) => (
                    <tr key={y.year} className="border-b border-border last:border-0">
                      <td className="px-2 py-2">{y.year}</td>
                      <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{y.sales}</td>
                      <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{y.lots.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {uploadResult && (
        <div className="mb-3 p-2.5 rounded border border-sage bg-sage-light text-[12.5px]" style={{ color: "var(--sage-dark)" }}>
          {uploadResult.filesImported} file(s) imported, {uploadResult.rowsImported.toLocaleString()} row(s).
          {uploadResult.errors.length > 0 && ` ${uploadResult.errors.length} error(s): ${uploadResult.errors.join("; ")}`}
        </div>
      )}

      <div className="border-t border-border pt-3">
        <p className="text-[11.5px] text-text-muted m-0 mb-2">Upload a file into the archive</p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <Select
            size="small"
            value={uploadType}
            onChange={(e) => {
              setUploadType(e.target.value as MslUploadType);
              setUploadResult(null);
            }}
            sx={{ minWidth: 200 }}
          >
            <MenuItem value="auction">Auction Sale Broker File (.TXT)</MenuItem>
            <MenuItem value="private">Private Sale File (.TXT)</MenuItem>
            <MenuItem value="teaboard">Tea Board Report (.pdf)</MenuItem>
          </Select>

          {uploadType === "auction" && (
            <>
              <TextField label="Year" size="small" type="number" value={year} onChange={(e) => setYear(e.target.value)} sx={{ width: 100 }} />
              <TextField label="Sale No" size="small" type="number" value={saleNo} onChange={(e) => setSaleNo(e.target.value)} sx={{ width: 100 }} />
            </>
          )}
          {uploadType === "teaboard" && (
            <>
              <TextField label="Year" size="small" type="number" value={year} onChange={(e) => setYear(e.target.value)} sx={{ width: 100 }} />
              <TextField label="Month" size="small" type="number" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ width: 100 }} />
            </>
          )}

          <input
            ref={fileInputRef}
            type="file"
            className="hidden"
            accept={uploadType === "teaboard" ? ".pdf" : ".txt"}
            onChange={onFileChosen}
          />
          <Button
            variant="outlined"
            size="small"
            startIcon={<CloudUploadOutlinedIcon fontSize="small" />}
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadBusy || !fieldsValid}
          >
            {uploadBusy ? "Uploading…" : "Upload"}
          </Button>
        </div>

        <Button size="small" onClick={() => rescan(false)} disabled={rescanBusy} sx={{ mr: 1 }}>
          {rescanBusy ? "Scanning…" : "Rescan"}
        </Button>
        <Button size="small" color="warning" onClick={() => rescan(true)} disabled={rescanBusy}>
          Force Full Rescan
        </Button>
      </div>
    </SectionCard>
  );
}

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
  const [editTarget, setEditTarget] = useState<AuthUser | null>(null);
  const [editEmail, setEditEmail] = useState("");
  const [editDisplayName, setEditDisplayName] = useState("");
  const [editPassword, setEditPassword] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

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

  const changeRoles = async (id: string, roles: string[]) => {
    setError(null);
    try {
      const updated = await api.setUserRole(id, roles);
      setUsers((list) => list.map((u) => (u.id === id ? updated : u)));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't change that user's roles");
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

  const openEdit = (u: AuthUser) => {
    setEditTarget(u);
    setEditEmail(u.email);
    setEditDisplayName(u.displayName);
    setEditPassword("");
    setEditError(null);
  };

  const emailChanged = (editTarget && editEmail.trim().toLowerCase() !== editTarget.email) ?? false;
  const displayNameChanged = (editTarget && editDisplayName.trim() !== editTarget.displayName) ?? false;
  const editHasChanges = emailChanged || displayNameChanged || editPassword.trim().length > 0;

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editTarget || !editHasChanges) return;
    setEditBusy(true);
    setEditError(null);
    try {
      const updated = await api.updateUserCredentials(editTarget.id, {
        email: emailChanged ? editEmail.trim() : undefined,
        displayName: displayNameChanged ? editDisplayName.trim() : undefined,
        newPassword: editPassword.trim() || undefined,
      });
      setUsers((list) => list.map((u) => (u.id === updated.id ? updated : u)));
      setEditTarget(null);
    } catch (err) {
      setEditError(err instanceof ApiError ? err.message : "Couldn't update that account");
    } finally {
      setEditBusy(false);
    }
  };

  return (
    <SectionCard id="users" title="Users" subtitle="Everyone with access to this workspace.">
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
                      multiple
                      value={u.roles}
                      onChange={(e) => changeRoles(u.id, e.target.value as string[])}
                      renderValue={(selected) => (selected as string[]).map(roleLabel).join(", ")}
                      sx={{ fontSize: 13, minWidth: 140 }}
                    >
                      {ROLES.map((r) => (
                        <MenuItem key={r} value={r} dense>
                          <Checkbox size="small" checked={u.roles.includes(r)} sx={{ p: 0.5, mr: 0.5 }} />
                          {ROLE_LABELS[r]}
                        </MenuItem>
                      ))}
                    </Select>
                  </td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[11.5px]">{new Date(u.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <Button size="small" startIcon={<EditOutlinedIcon fontSize="small" />} onClick={() => openEdit(u)}>
                      Edit
                    </Button>
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

      <Dialog open={!!editTarget} onClose={() => (editBusy ? null : setEditTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Edit {editTarget?.displayName}</DialogTitle>
        <form onSubmit={saveEdit}>
          <DialogContent>
            {editError && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{editError}</div>}
            <div className="flex flex-col gap-3">
              <TextField
                label="Display name"
                size="small"
                value={editDisplayName}
                onChange={(e) => setEditDisplayName(e.target.value)}
                helperText="Shown in the dashboard greeting and top bar."
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="Email"
                type="email"
                size="small"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                helperText="Must be unique — no two accounts can share an email."
                required
                fullWidth
              />
              <TextField
                label="New password"
                type="password"
                size="small"
                value={editPassword}
                onChange={(e) => setEditPassword(e.target.value)}
                helperText="Leave blank to keep their current password. At least 8 characters if set."
                fullWidth
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setEditTarget(null)} disabled={editBusy}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="contained"
              disabled={editBusy || !editHasChanges || (editPassword.trim().length > 0 && editPassword.trim().length < 8)}
              aria-busy={editBusy}
            >
              {editBusy ? "Saving…" : "Save Changes"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

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
    </SectionCard>
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

function ApiKeysSection() {
  const [keys, setKeys] = useState<ApiKeySummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addRoles, setAddRoles] = useState<string[]>(["User"]);
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

  const toggleRole = (role: string) => {
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
    <SectionCard id="apikeys" title="API Keys" subtitle="Credentials for external tools (e.g. an n8n workflow) to call this API without a human login.">
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
                {ROLES.map((role) => (
                  <FormControlLabel
                    key={role}
                    control={<Checkbox size="small" checked={addRoles.includes(role)} onChange={() => toggleRole(role)} />}
                    label={ROLE_LABELS[role]}
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
    </SectionCard>
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
    <SectionCard id="webhooks" title="Webhooks" subtitle="Notify an external tool (e.g. n8n) when something happens in this app.">
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
    </SectionCard>
  );
}

const MASTER_DATA_TYPES = ["Broker", "Buyer", "Garden", "Grade", "Category", "Elevation", "Region", "Warehouse", "Factory"] as const;

/** Canonical broker/buyer/garden/grade/... names + the raw spelling variants (aliases) that
 *  should resolve to them — resolution itself happens server-side, at read time, in
 *  Analytics/Market/Reports/Assistant; this is only the admin CRUD plus the "what's still
 *  unmapped" discovery scan that drives it (see MasterDataController.Unmapped). */
function MasterDataSection() {
  const [type, setType] = useState<string>(MASTER_DATA_TYPES[0]);
  const [entities, setEntities] = useState<MasterDataEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [unmapped, setUnmapped] = useState<UnmappedMasterDataValue[]>([]);
  const [unmappedLoading, setUnmappedLoading] = useState(false);
  const [unmappedError, setUnmappedError] = useState<string | null>(null);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<MasterDataEntity | null>(null);
  const [formType, setFormType] = useState<string>(MASTER_DATA_TYPES[0]);
  const [formCanonicalName, setFormCanonicalName] = useState("");
  const [formAliases, setFormAliases] = useState("");
  const [formBusy, setFormBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [deleteTarget, setDeleteTarget] = useState<MasterDataEntity | null>(null);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const refresh = (t: string) => {
    setLoading(true);
    api
      .listMasterData(t)
      .then(setEntities)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load master data"))
      .finally(() => setLoading(false));
  };

  const scanUnmapped = (t: string) => {
    setUnmappedLoading(true);
    setUnmappedError(null);
    api
      .getUnmappedMasterData(t)
      .then(setUnmapped)
      .catch((e) => setUnmappedError(e instanceof ApiError ? e.message : "Couldn't scan for unmapped values"))
      .finally(() => setUnmappedLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh(type);
    setUnmapped([]);
  }, [type]);

  const openCreate = (prefill?: string) => {
    setEditing(null);
    setFormType(type);
    setFormCanonicalName(prefill ?? "");
    setFormAliases(prefill ?? "");
    setFormError(null);
    setDialogOpen(true);
  };

  const openEdit = (entity: MasterDataEntity) => {
    setEditing(entity);
    setFormType(entity.type);
    setFormCanonicalName(entity.canonicalName);
    setFormAliases(entity.aliases.join(", "));
    setFormError(null);
    setDialogOpen(true);
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormBusy(true);
    setFormError(null);
    const aliases = formAliases
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    try {
      if (editing) await api.updateMasterData(editing.id, formType, formCanonicalName.trim(), aliases);
      else await api.createMasterData(formType, formCanonicalName.trim(), aliases);
      setDialogOpen(false);
      refresh(type);
      if (unmapped.length > 0) scanUnmapped(type);
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : "Couldn't save that entity");
    } finally {
      setFormBusy(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await api.deleteMasterData(deleteTarget.id);
      setEntities((list) => list.filter((e) => e.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete that entity");
      setDeleteTarget(null);
    } finally {
      setDeleteBusy(false);
    }
  };

  return (
    <SectionCard
      id="masterdata"
      title="Master Data"
      subtitle="Canonical names for brokers, buyers, gardens, grades and more, so spelling variants across broker files merge into one row instead of splitting reports and analytics."
    >
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}

      <div className="flex items-center justify-between gap-3 mb-3">
        <Select size="small" value={type} onChange={(e) => setType(e.target.value)}>
          {MASTER_DATA_TYPES.map((t) => (
            <MenuItem key={t} value={t}>
              {t}
            </MenuItem>
          ))}
        </Select>
        <Button variant="outlined" size="small" startIcon={<AddOutlinedIcon fontSize="small" />} onClick={() => openCreate()}>
          New {type} Entity
        </Button>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : entities.length === 0 ? (
        <p className="text-[12.5px] text-text-muted m-0 mb-4">No canonical {type.toLowerCase()} entities yet.</p>
      ) : (
        <div className="overflow-x-auto mb-4">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Canonical Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Aliases</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {entities.map((e) => (
                <tr key={e.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{e.canonicalName}</td>
                  <td className="px-2 py-2 text-text-muted truncate max-w-[420px]">{e.aliases.join(", ") || "—"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <IconButton size="small" onClick={() => openEdit(e)} aria-label="Edit">
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => setDeleteTarget(e)} aria-label="Delete">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="border-t border-border pt-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <p className="text-[12.5px] text-text-muted m-0">
            Spelling variants for <strong>{type}</strong> still seen in sale files that aren&apos;t mapped to a canonical entity yet.
          </p>
          <Button size="small" onClick={() => scanUnmapped(type)} disabled={unmappedLoading}>
            {unmappedLoading ? "Scanning…" : "Scan"}
          </Button>
        </div>
        {unmappedError && (
          <div className="mb-2 p-2 rounded border border-danger bg-danger-light text-[12px] text-liquor-dark">{unmappedError}</div>
        )}
        {unmapped.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col gap-1 max-h-[240px] overflow-y-auto">
            {unmapped.map((u) => (
              <li key={u.value} className="flex items-center justify-between gap-2 text-[12.5px] px-2 py-1 rounded bg-surface-sunken">
                <span className="truncate">{u.value}</span>
                <span className="flex items-center gap-2 shrink-0">
                  <span className="text-text-muted font-mono text-[11px]">
                    {u.count} lot{u.count === 1 ? "" : "s"}
                  </span>
                  <Button size="small" onClick={() => openCreate(u.value)}>
                    Add
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <Dialog open={dialogOpen} onClose={() => (formBusy ? null : setDialogOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>{editing ? "Edit Entity" : "New Entity"}</DialogTitle>
        <form onSubmit={save}>
          <DialogContent>
            {formError && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{formError}</div>}
            <div className="flex flex-col gap-3">
              <Select size="small" value={formType} onChange={(e) => setFormType(e.target.value)} disabled={!!editing} fullWidth>
                {MASTER_DATA_TYPES.map((t) => (
                  <MenuItem key={t} value={t}>
                    {t}
                  </MenuItem>
                ))}
              </Select>
              <TextField
                label="Canonical Name"
                size="small"
                placeholder="e.g. ABC Ltd"
                value={formCanonicalName}
                onChange={(e) => setFormCanonicalName(e.target.value)}
                autoFocus
                required
                fullWidth
              />
              <TextField
                label="Aliases"
                size="small"
                placeholder="e.g. A.B.C. Ltd, ABC LIMITED"
                helperText="Comma-separated spelling variants that should map to the canonical name above."
                value={formAliases}
                onChange={(e) => setFormAliases(e.target.value)}
                multiline
                minRows={2}
                fullWidth
              />
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setDialogOpen(false)} disabled={formBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={formBusy || !formCanonicalName.trim()} aria-busy={formBusy}>
              {formBusy ? "Saving…" : editing ? "Save" : "Create"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      <Dialog open={!!deleteTarget} onClose={() => (deleteBusy ? null : setDeleteTarget(null))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Delete Entity</DialogTitle>
        <DialogContent>
          <p className="text-[13px] text-text m-0">
            Delete <strong>{deleteTarget?.canonicalName}</strong>? Its aliases will stop resolving and go back to appearing as separate
            values in reports and analytics. This can&apos;t be undone.
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
    </SectionCard>
  );
}

const AUDIT_LOG_PAGE_SIZE = 50;

/** Read-only view of the audit trail — entries are written inline from the actions being
 *  audited (role changes, API key/webhook/master-data/knowledge-base/system-file uploads),
 *  never from here. */
function AuditLogSection() {
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    api
      .listAuditLog(0, AUDIT_LOG_PAGE_SIZE)
      .then((page) => {
        setEntries(page);
        setHasMore(page.length === AUDIT_LOG_PAGE_SIZE);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load the audit log"))
      .finally(() => setLoading(false));
  }, []);

  const loadMore = () => {
    setLoadingMore(true);
    api
      .listAuditLog(entries.length, AUDIT_LOG_PAGE_SIZE)
      .then((page) => {
        setEntries((list) => [...list, ...page]);
        setHasMore(page.length === AUDIT_LOG_PAGE_SIZE);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load more entries"))
      .finally(() => setLoadingMore(false));
  };

  return (
    <SectionCard id="audit" title="Audit Log" subtitle="Who did what — role changes, API keys, webhooks, master data, files and knowledge base uploads.">
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[12.5px] text-text-muted m-0">Nothing recorded yet.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border">
                  <th className="text-left px-2 py-2 font-medium text-text-muted">When</th>
                  <th className="text-left px-2 py-2 font-medium text-text-muted">User</th>
                  <th className="text-left px-2 py-2 font-medium text-text-muted">Action</th>
                  <th className="text-left px-2 py-2 font-medium text-text-muted">Entity</th>
                  <th className="text-left px-2 py-2 font-medium text-text-muted">Details</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-border last:border-0">
                    <td className="px-2 py-2 text-text-muted font-mono text-[11.5px] whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="px-2 py-2 text-text-muted">{e.userEmail ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-[11.5px]">{e.action}</td>
                    <td className="px-2 py-2 text-text-muted">{e.entityType ?? "—"}</td>
                    <td className="px-2 py-2 text-text-muted truncate max-w-[320px]">{e.details ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {hasMore && (
            <div className="flex justify-center mt-3">
              <Button size="small" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          )}
        </>
      )}
    </SectionCard>
  );
}

/** Everything Settings used to gate behind isAdmin, plus the new file manager — pulled into
 *  its own route so it reads as the administrator's command center rather than a few extra
 *  rows tucked under personal account settings. Non-admins never had a way here (no nav tile,
 *  no command palette entry — see nav.ts's `adminOnly`), but a direct URL visit still gets
 *  turned away rather than silently rendering an empty admin page. */
export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;

  if (authLoading) return null;

  if (!isAdmin) {
    return (
      <div className="max-w-md mx-auto text-center py-20">
        <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 40, color: "var(--text-muted)" }} />
        <h1 className="font-display text-xl font-bold mt-3 mb-1" style={{ color: "var(--text-strong)" }}>
          Admins only
        </h1>
        <p className="text-[13px] text-text-muted">This area is restricted to accounts with the Admin role.</p>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Admin Panel" subtitle="Full administrative control — users, access, master data, sale/MSL data and the system's shared files." />

      <div
        className="mb-6 inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-[12px] font-semibold"
        style={{ background: "var(--tile-gradient-4)", color: "#fff" }}
      >
        <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 16 }} />
        Administrator access — {user?.displayName}
      </div>

      <FilesSection />
      <SalesDataSection />
      <MslDataSection />
      <UsersSection />
      <ApiKeysSection />
      <WebhooksSection />
      <MasterDataSection />
      <AuditLogSection />
    </div>
  );
}
