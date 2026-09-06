"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { api } from "@/lib/api";
import { DOCUMENT_CATEGORY_LABELS } from "@/lib/documentCategories";
import { HELP_FAQS } from "@/lib/helpFaqs";
import type { DocumentSearchResult, LearningContentCategory, LearningContentItem } from "@/types/api";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import PlayCircleOutlineIcon from "@mui/icons-material/PlayCircleOutlineOutlined";
import SearchOutlinedIcon from "@mui/icons-material/SearchOutlined";
import SpaOutlinedIcon from "@mui/icons-material/SpaOutlined";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import Button from "@mui/material/Button";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Grow from "@mui/material/Grow";
import IconButton from "@mui/material/IconButton";
import InputAdornment from "@mui/material/InputAdornment";
import TextField from "@mui/material/TextField";
import CloseIcon from "@mui/icons-material/Close";
import { forwardRef, useEffect, useMemo, useState, type ReactElement, type Ref } from "react";
import type { TransitionProps } from "@mui/material/transitions";

const CATEGORY_TABS: { value: LearningContentCategory | "all"; label: string; icon: typeof AutoAwesomeOutlinedIcon }[] = [
  { value: "all", label: "All", icon: AutoAwesomeOutlinedIcon },
  { value: "ModuleGuidance", label: "Module Guidance", icon: AutoAwesomeOutlinedIcon },
  { value: "TeaEducation", label: "Tea Education", icon: SpaOutlinedIcon },
  { value: "Article", label: "Articles", icon: DescriptionOutlinedIcon },
];

const CATEGORY_LABEL: Record<LearningContentCategory, string> = {
  ModuleGuidance: "Module Guidance",
  TeaEducation: "Tea Education",
  Article: "Article",
};

// A visible, scale-up-from-the-button entrance for the "Read More" dialog — the brief's own
// "comes a window animatively" — rather than MUI's default plain fade.
const GrowTransition = forwardRef(function GrowTransition(
  props: TransitionProps & { children: ReactElement },
  ref: Ref<unknown>
) {
  return <Grow ref={ref} {...props} />;
});

/**
 * One "Learn" row — a plain bordered card matching this app's own established list-row
 * style (same shape as the Help/Search-results cards below), not a photo-poster tile:
 * description + a "Read More" button on the left, the short title centered in the middle,
 * and a real image on the right (a play badge overlays it when a video exists — the video
 * itself only plays once opened, in the Read More dialog).
 */
function LearningRow({ item, onReadMore }: { item: LearningContentItem; onReadMore: () => void }) {
  return (
    <div className="flex items-stretch gap-4 border border-border rounded-[var(--radius-lg)] bg-surface p-4 min-h-[132px]">
      <div className="flex-1 min-w-0 flex flex-col justify-center gap-1.5">
        <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted">{CATEGORY_LABEL[item.category]}</span>
        <h3 className="font-display text-[15px] font-semibold m-0 text-text-strong sm:hidden">{item.title}</h3>
        <p className="text-[13px] text-text-muted leading-relaxed m-0 line-clamp-3">{item.tagline}</p>
        <div>
          <Button size="small" variant="outlined" onClick={onReadMore} sx={{ mt: 0.5 }}>
            Read More
          </Button>
        </div>
      </div>

      <div className="w-[200px] shrink-0 hidden sm:flex items-center justify-center text-center px-3 border-l border-r border-border">
        <h3 className="font-display text-[16px] font-semibold m-0 text-text-strong leading-snug">{item.title}</h3>
      </div>

      <div className="w-[140px] shrink-0 relative rounded-[var(--radius-md)] overflow-hidden">
        <div className="absolute inset-0 bg-cover bg-center" style={{ backgroundImage: `url(${item.imageUrl})` }} />
        {item.videoUrl && (
          <div className="absolute inset-0 flex items-center justify-center" style={{ background: "rgba(10,12,8,0.35)" }}>
            <PlayCircleOutlineIcon sx={{ fontSize: 30, color: "#fff" }} />
          </div>
        )}
      </div>
    </div>
  );
}

export default function KnowledgeBasePage() {
  const [items, setItems] = useState<LearningContentItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [activeCategory, setActiveCategory] = useState<LearningContentCategory | "all">("all");
  const [openItem, setOpenItem] = useState<LearningContentItem | null>(null);

  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<DocumentSearchResult[] | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLearningContent()
      .then(setItems)
      .catch((e) => setLoadError(e instanceof Error ? e.message : "Couldn't load learning content"));
  }, []);

  const filtered = useMemo(() => {
    if (!items) return [];
    return activeCategory === "all" ? items : items.filter((i) => i.category === activeCategory);
  }, [items, activeCategory]);

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
        subtitle="Learn the platform and the trade — module walkthroughs, tea education, quick answers, and document search, all in one place."
      />

      {/* ---- Learn: category tabs + a plain scannable list of content rows ---- */}
      <div className="mb-4 flex gap-2 flex-wrap">
        {CATEGORY_TABS.map((t) => (
          <Button
            key={t.value}
            size="small"
            variant={activeCategory === t.value ? "contained" : "outlined"}
            startIcon={<t.icon fontSize="small" />}
            onClick={() => setActiveCategory(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {loadError && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">{loadError}</div>
      )}

      {items === null ? (
        <div className="flex justify-center py-10">
          <TeaLoader size={44} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-text-muted border border-dashed border-border rounded-[var(--radius-lg)] mb-8">
          <p className="m-0">No content in this category yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3 mb-8">
          {filtered.map((item) => (
            <LearningRow key={item.id} item={item} onReadMore={() => setOpenItem(item)} />
          ))}
        </div>
      )}

      <Dialog open={openItem !== null} onClose={() => setOpenItem(null)} maxWidth="sm" fullWidth slots={{ transition: GrowTransition }}>
        {openItem && (
          <>
            <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              {openItem.title}
              <IconButton size="small" onClick={() => setOpenItem(null)} sx={{ ml: "auto" }}>
                <CloseIcon fontSize="small" />
              </IconButton>
            </DialogTitle>
            <DialogContent>
              {openItem.videoUrl ? (
                <video src={openItem.videoUrl} controls className="w-full rounded-[var(--radius-lg)] mb-3" style={{ maxHeight: 300 }} />
              ) : (
                <div
                  className="flex flex-col items-center justify-center gap-2 py-8 mb-3 rounded-[var(--radius-lg)] border border-dashed border-border text-center"
                  style={{ background: "var(--surface-sunken)" }}
                >
                  <PlayCircleOutlineIcon sx={{ fontSize: 32, color: "var(--text-muted)" }} />
                  <p className="text-[13px] text-text-muted m-0">Video walkthrough coming soon</p>
                </div>
              )}
              <p className="text-[13.5px] leading-relaxed text-text m-0 whitespace-pre-wrap">{openItem.body}</p>
            </DialogContent>
          </>
        )}
      </Dialog>

      {/* ---- Help: folded in from the standalone Help page (same content, lib/helpFaqs.ts) ---- */}
      <h2 className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-2.5">Help</h2>
      <div className="grid gap-3 mb-8" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))" }}>
        {HELP_FAQS.map((f) => (
          <div key={f.q} className="border border-border rounded-[var(--radius-lg)] bg-surface p-4">
            <h3 className="font-display text-[14px] text-text-strong mb-1.5">{f.q}</h3>
            <p className="text-[12.5px] text-text-muted leading-relaxed m-0">{f.a}</p>
          </div>
        ))}
      </div>

      {/* ---- Search documents: read-only, every signed-in user (upload/manage moved to
           Admin Panel's Knowledge Documents section — this page is a learning hub now,
           not a data-input surface) ---- */}
      <h2 className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-2.5">Search Documents</h2>
      <form onSubmit={runSearch} className="mb-4 flex gap-2.5">
        <TextField
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search circulars, SOPs and policies…"
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
        <div>
          <h3 className="font-mono text-[10px] tracking-widest uppercase text-text-muted mb-2.5">
            {results.length === 0 ? "No matches" : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </h3>
          <div className="flex flex-col gap-2.5">
            {results.map((r, i) => (
              <div key={i} className="border border-border rounded-[var(--radius-lg)] bg-surface p-3.5">
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="text-[11px] font-mono text-text-muted">{r.documentFileName}</span>
                  <span className="font-mono text-[10px] tracking-widest uppercase text-text-muted border border-border rounded px-1.5 py-0.5">
                    {DOCUMENT_CATEGORY_LABELS[r.category as keyof typeof DOCUMENT_CATEGORY_LABELS] ?? r.category}
                  </span>
                </div>
                <p className="text-[13px] text-text m-0 leading-relaxed whitespace-pre-wrap">{r.chunkText}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
