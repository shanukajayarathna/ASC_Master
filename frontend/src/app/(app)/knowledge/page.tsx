"use client";

import { api } from "@/lib/api";
import type { DocumentSearchResult, KnowledgeDocument } from "@/types/api";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import UploadFileOutlinedIcon from "@mui/icons-material/UploadFileOutlined";
import Button from "@mui/material/Button";
import CircularProgress from "@mui/material/CircularProgress";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function KnowledgeBasePage() {
  const [documents, setDocuments] = useState<KnowledgeDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DocumentSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

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

  const handleFile = async (file: File) => {
    setUploading(true);
    setError(null);
    try {
      await api.uploadDocument(file);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async (id: string) => {
    await api.deleteDocument(id);
    setDocuments((docs) => docs.filter((d) => d.id !== id));
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
      <div className="mb-5">
        <h1 className="font-display text-2xl font-bold text-text-strong m-0 mb-1">Knowledge Base</h1>
        <p className="text-[13px] text-text-muted m-0 max-w-xl">
          Upload PDFs, Word, PowerPoint and Excel documents — circulars, SOPs, policies — and search across them.
        </p>
      </div>

      {error && (
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{error}</div>
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
        <div className="mb-4 p-3.5 rounded border border-danger bg-danger-light text-sm text-liquor-dark">{searchError}</div>
      )}

      {results && (
        <div className="mb-8">
          <h2 className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-2.5">
            {results.length === 0 ? "No matches" : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </h2>
          <div className="flex flex-col gap-2.5">
            {results.map((r, i) => (
              <div key={i} className="border border-border rounded-lg bg-surface p-3.5">
                <div className="text-[11px] font-mono text-text-muted mb-1.5">{r.documentFileName}</div>
                <p className="text-[13px] text-text m-0 leading-relaxed whitespace-pre-wrap">{r.chunkText}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between mb-2.5">
        <h2 className="font-mono text-[10px] tracking-widest uppercase text-text-muted m-0">Documents</h2>
        <Button
          variant="outlined"
          size="small"
          startIcon={<UploadFileOutlinedIcon fontSize="small" />}
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading}
        >
          {uploading ? "Uploading…" : "Upload"}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.pptx,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) handleFile(f);
            e.target.value = "";
          }}
        />
      </div>

      {loading ? (
        <div className="flex justify-center py-10">
          <CircularProgress size={22} sx={{ color: "var(--liquor)" }} />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12 text-text-muted border border-dashed border-border rounded-lg">
          <p className="m-0">No documents uploaded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {documents.map((d) => (
            <div key={d.id} className="flex items-center gap-3 border border-border rounded-lg bg-surface px-3.5 py-2.5">
              <div className="flex-1 min-w-0">
                <div className="text-[13px] text-text-strong truncate">{d.fileName}</div>
                <div className="text-[11px] text-text-muted font-mono">
                  {formatSize(d.sizeBytes)} · {new Date(d.uploadedAt).toLocaleString()}
                </div>
              </div>
              <Tooltip title="Delete">
                <IconButton size="small" onClick={() => handleDelete(d.id)} aria-label={`Delete ${d.fileName}`}>
                  <DeleteOutlineIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
