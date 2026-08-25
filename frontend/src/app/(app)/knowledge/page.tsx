"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api } from "@/lib/api";
import { DOCUMENT_CATEGORIES, DOCUMENT_CATEGORY_LABELS } from "@/lib/documentCategories";
import type { DocumentSearchResult, KnowledgeDocument } from "@/types/api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import SyncOutlinedIcon from "@mui/icons-material/SyncOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** The page's established "meta label" style (see the "Documents"/"No matches" headers
 *  below) reused as a small badge — categories are distinguished by their text, not color,
 *  so this stays neutral rather than inventing a semantic color per category. */
function CategoryBadge({ category }: { category: string }) {
  return (
    <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted border border-border rounded px-1.5 py-0.5">
      {DOCUMENT_CATEGORY_LABELS[category as keyof typeof DOCUMENT_CATEGORY_LABELS] ?? category}
    </span>
  );
}

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Document whose delete is in flight — its button locks so a double-click can't fire twice.
  const [deletingId, setDeletingId] = useState<string | null>(null);
  // Platform-docs sync: embeds every changed docs/*.md server-side, so it can take a minute.
  const [syncing, setSyncing] = useState(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DocumentSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadCategory, setUploadCategory] = useState<string>("Internal");
  const [uploadEffectiveDate, setUploadEffectiveDate] = useState("");
  const [uploadExpiryDate, setUploadExpiryDate] = useState("");
  const [uploadSupersedes, setUploadSupersedes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const refresh = () => {
    setLoading(true);
    api
      .listDocuments()
      .then(setDocuments)
      .catch((e) => setError(e instanceof Error ? e.message : "Couldn't load documents"))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, []);

  const resetUploadForm = () => {
    setUploadFile(null);
    setUploadCategory("Internal");
    setUploadEffectiveDate("");
    setUploadExpiryDate("");
    setUploadSupersedes("");
    setUploadError(null);
  };

  const submitUpload = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    try {
      await api.uploadDocument(
        uploadFile,
        uploadCategory,
        uploadEffectiveDate || undefined,
        uploadExpiryDate || undefined,
        uploadSupersedes || undefined
      );
      setUploadOpen(false);
      resetUploadForm();
      refresh();
    } catch (e) {
      setUploadError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const syncPlatformDocs = async () => {
    setSyncing(true);
    setSyncNotice(null);
    setError(null);
    try {
      const r = await api.syncPlatformDocs();
      const failed = r.failed.length > 0 ? ` ${r.failed.length} failed: ${r.failed.join("; ")}` : "";
      setSyncNotice(
        `Platform docs synced — ${r.added} added, ${r.updated} updated, ${r.unchanged} already up to date.${failed}`
      );
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Platform docs sync failed");
    } finally {
      setSyncing(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await api.deleteDocument(id);
      setDocuments((docs) => docs.filter((d) => d.id !== id));
    } finally {
      setDeletingId(null);
    }
  };

  const runSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!query.trim()) return;
    setSearching(true);
    setSearchError(null);
    try {
      setResults(await api.searchDocuments(query.trim()));
    } catch (e) {
      setSearchError(e instanceof Error ? e.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  return (
    <div>
      <PageHeader
        title="Knowledge Base"
        subtitle="Upload PDFs, Word, PowerPoint and Excel documents — circulars, SOPs, policies — and search across them."
      />

      {error && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{error}</div>
      )}

      <form onSubmit={runSearch} className="mb-6 flex gap-2.5">
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search the knowledge base…"
          size="small"
          fullWidth
          slotProps={{
            input: {
              startAdornment: (
                <InputAdornment position="start">
                  <SearchOutlinedIcon fontSize="small" />
                </InputAdornment>
              ),
            },
          }}
        />
        <Button type="submit" variant="contained" color="primary" disabled={searching || !query.trim()}>
          {searching ? "Searching…" : "Search"}
        </Button>
      </form>

      {searchError && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{searchError}</div>
      )}

      {results && (
        <div className="mb-8">
          <h2 className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-2.5">
            {results.length === 0 ? "No matches" : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </h2>
          <div className="flex flex-col gap-2.5">
            {results.map((r, i) => (
              <div key={i} className="border border-border rounded-[var(--radius-lg)] bg-surface p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-mono text-text-muted">{r.documentFileName}</span>
                  <CategoryBadge category={r.category} />
                </div>
                <p className="text-[13px] text-text m-0 leading-relaxed whitespace-pre-wrap">{r.chunkText}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between gap-2 flex-wrap mb-2.5">
        <h2 className="font-mono text-[10px] tracking-widest uppercase text-text-muted m-0">Documents</h2>
        <div className="flex items-center gap-2 flex-wrap">
          <Tooltip title="Bring the platform's own documentation (every module guide) into the knowledge base so the AI Assistant can answer questions about how ASC Hub works. Safe to re-run — only changed docs are re-processed.">
            <span>
              <Button
                variant="outlined"
                size="small"
                startIcon={syncing ? <CircularProgress size={14} /> : <SyncOutlinedIcon fontSize="small" />}
                onClick={syncPlatformDocs}
                disabled={syncing}
                aria-busy={syncing}
              >
                {syncing ? "Syncing…" : "Sync platform docs"}
              </Button>
            </span>
          </Tooltip>
          <Button
            variant="outlined"
            size="small"
            startIcon={<UploadFileOutlinedIcon fontSize="small" />}
            onClick={() => setUploadOpen(true)}
          >
            Upload
          </Button>
        </div>
      </div>

      {syncNotice && (
        <div className="flex items-center gap-2 mb-3 px-3 py-2 rounded-[var(--radius-lg)] border border-sage bg-sage-light text-[13px]" style={{ color: "var(--sage-dark)" }}>
          {syncNotice}
          <button
            type="button"
            onClick={() => setSyncNotice(null)}
            className="ml-auto bg-transparent border-none cursor-pointer underline text-[12px]"
            style={{ color: "var(--sage-dark)" }}
          >
            Dismiss
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10">
          <TeaLoader size={44} />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-[var(--radius-lg)]">
          <p className="m-0">No documents uploaded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((d) => {
            const supersededByName = d.supersededByDocumentId
              ? documents.find((other) => other.id === d.supersededByDocumentId)?.fileName
              : null;
            return (
              <div key={d.id} className="flex items-center gap-3 border border-border rounded-[var(--radius-lg)] bg-surface px-3.5 py-2.5">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-[13px] text-text-strong truncate">{d.fileName}</span>
                    <CategoryBadge category={d.category} />
                  </div>
                  <div className="text-[11px] text-text-muted font-mono">
                    {formatSize(d.sizeBytes)} · {new Date(d.uploadedAt).toLocaleString()}
                    {d.effectiveDate && ` · effective ${new Date(d.effectiveDate).toLocaleDateString()}`}
                    {d.expiryDate && ` · expires ${new Date(d.expiryDate).toLocaleDateString()}`}
                  </div>
                  {supersededByName && (
                    <div className="text-[11px] text-text-muted italic mt-0.5">Superseded by {supersededByName}</div>
                  )}
                </div>
                <Tooltip title="Delete">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(d.id)}
                      disabled={deletingId === d.id}
                      aria-busy={deletingId === d.id}
                      aria-label={`Delete ${d.fileName}`}
                    >
                      {deletingId === d.id ? <CircularProgress size={16} /> : <DeleteOutlineIcon fontSize="small" />}
                    </IconButton>
                  </span>
                </Tooltip>
              </div>
            );
          })}
        </div>
      )}

      <Dialog open={uploadOpen} onClose={() => (uploading ? null : setUploadOpen(false))} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ pb: 0.5 }}>Upload Document</DialogTitle>
        <form onSubmit={submitUpload}>
          <DialogContent>
            {uploadError && (
              <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{uploadError}</div>
            )}
            <div className="flex flex-col gap-3">
              <div>
                <Button variant="outlined" size="small" fullWidth onClick={() => fileInputRef.current?.click()}>
                  {uploadFile ? uploadFile.name : "Choose File"}
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pdf,.docx,.pptx,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => setUploadFile(e.target.files?.[0] ?? null)}
                />
              </div>

              <Select size="small" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)} fullWidth>
                {DOCUMENT_CATEGORIES.map((c) => (
                  <MenuItem key={c} value={c}>
                    {DOCUMENT_CATEGORY_LABELS[c]}
                  </MenuItem>
                ))}
              </Select>

              <TextField
                label="Effective date"
                type="date"
                size="small"
                value={uploadEffectiveDate}
                onChange={(e) => setUploadEffectiveDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Optional — when this document's guidance starts applying."
                fullWidth
              />
              <TextField
                label="Expiry date"
                type="date"
                size="small"
                value={uploadExpiryDate}
                onChange={(e) => setUploadExpiryDate(e.target.value)}
                slotProps={{ inputLabel: { shrink: true } }}
                helperText="Optional — when it stops applying."
                fullWidth
              />

              <Select
                size="small"
                value={uploadSupersedes}
                onChange={(e) => setUploadSupersedes(e.target.value)}
                displayEmpty
                fullWidth
              >
                <MenuItem value="">This is a new document</MenuItem>
                {documents.map((d) => (
                  <MenuItem key={d.id} value={d.id}>
                    Supersedes: {d.fileName}
                  </MenuItem>
                ))}
              </Select>
            </div>
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setUploadOpen(false)} disabled={uploading}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={uploading || !uploadFile} aria-busy={uploading}>
              {uploading ? "Uploading…" : "Upload"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </div>
  );
}
