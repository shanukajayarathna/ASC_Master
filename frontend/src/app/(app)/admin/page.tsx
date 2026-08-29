"use client";

import PageHeader from "@/components/shared/PageHeader";
import TeaLoader from "@/components/shared/TeaLoader";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { api, ApiError } from "@/lib/api";
import { ROLE_LABELS, ROLES, roleLabel } from "@/lib/roles";
import type {
  AccessRequest,
  ApiKeySummary,
  AuditLogEntry,
  AuthUser,
  FactoryRecord,
  LandingIntelligenceItem,
  LandingPageContent,
  LandingPlatformStat,
  LandingTestimonial,
  MarkBrokerEra,
  MarkRecord,
  MarketPulseCategory,
  MarketPulseSource,
  MasterDataEntity,
  MiningRunResult,
  MslBatchUploadResult,
  MslScanSummary,
  MslStageBatchResult,
  MslStatus,
  MslTrackedFile,
  Plantation,
  UnmappedMasterDataValue,
  WebhookSummary,
} from "@/types/api";
import AccountTreeOutlinedIcon from "@mui/icons-material/AccountTreeOutlined";
import AddOutlinedIcon from "@mui/icons-material/AddOutlined";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import CategoryOutlinedIcon from "@mui/icons-material/CategoryOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import CloudUploadOutlinedIcon from "@mui/icons-material/CloudUploadOutlined";
import WarningAmberOutlinedIcon from "@mui/icons-material/WarningAmberOutlined";
import ContentCopyOutlinedIcon from "@mui/icons-material/ContentCopyOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import GroupOutlinedIcon from "@mui/icons-material/GroupOutlined";
import HistoryOutlinedIcon from "@mui/icons-material/HistoryOutlined";
import HowToRegOutlinedIcon from "@mui/icons-material/HowToRegOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LanguageOutlinedIcon from "@mui/icons-material/LanguageOutlined";
import LinkOutlinedIcon from "@mui/icons-material/LinkOutlined";
import NewspaperOutlinedIcon from "@mui/icons-material/NewspaperOutlined";
import PersonAddOutlinedIcon from "@mui/icons-material/PersonAddOutlined";
import ReceiptLongOutlinedIcon from "@mui/icons-material/ReceiptLongOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import VpnKeyOutlinedIcon from "@mui/icons-material/VpnKeyOutlined";
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
import Switch from "@mui/material/Switch";
import TextField from "@mui/material/TextField";
import Tooltip from "@mui/material/Tooltip";
import { useEffect, useRef, useState } from "react";

/** The Admin Panel's registry of its own sections — one source of truth for the quick-jump
 *  nav row and each section's header treatment (icon + accent), so adding a ninth section
 *  later means one new entry here, not two places kept in sync by hand. */
const ADMIN_SECTIONS = [
  { id: "sales", label: "Sales Data", icon: <ReceiptLongOutlinedIcon fontSize="small" />, accent: 3 as const },
  { id: "msl", label: "MSL Archive", icon: <Inventory2OutlinedIcon fontSize="small" />, accent: 2 as const },
  { id: "newssources", label: "News Sources", icon: <NewspaperOutlinedIcon fontSize="small" />, accent: 1 as const },
  { id: "landing", label: "Landing Page", icon: <LanguageOutlinedIcon fontSize="small" />, accent: 6 as const },
  { id: "accessrequests", label: "Access Requests", icon: <HowToRegOutlinedIcon fontSize="small" />, accent: 3 as const },
  { id: "users", label: "Users", icon: <GroupOutlinedIcon fontSize="small" />, accent: 5 as const },
  { id: "apikeys", label: "API Keys", icon: <VpnKeyOutlinedIcon fontSize="small" />, accent: 8 as const },
  { id: "webhooks", label: "Webhooks", icon: <LinkOutlinedIcon fontSize="small" />, accent: 6 as const },
  { id: "masterdata", label: "Master Data", icon: <CategoryOutlinedIcon fontSize="small" />, accent: 7 as const },
  { id: "markintelligence", label: "Mark Intelligence", icon: <AccountTreeOutlinedIcon fontSize="small" />, accent: 2 as const },
  { id: "audit", label: "Audit Log", icon: <HistoryOutlinedIcon fontSize="small" />, accent: 4 as const },
];

/** The app shell's Topbar (Shell.tsx) is `position: sticky` at the document level, but every
 *  fixed-position element *within* this admin page (the sidebar, the pinned header below)
 *  needs to know its real rendered height to sit just below it without guessing a pixel value
 *  that's wrong the moment the Topbar's content wraps differently. Shared by both so there's
 *  one measurement, not two independently-guessed ones that could drift apart. */
function useTopbarHeight(): number {
  const [height, setHeight] = useState(68);
  useEffect(() => {
    const topbar = document.querySelector<HTMLElement>(".app-topbar");
    if (!topbar) return;
    const update = () => setHeight(topbar.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(topbar);
    return () => observer.disconnect();
  }, []);
  return height;
}

/** Section sidebar — with 11 sections now on this page, a horizontal pill row got cramped
 *  fast, and a single long scroll wasn't navigable at all, so only the selected section
 *  renders: click an item, see that section, nothing else. Each section's own data-fetch
 *  effect only fires once it's actually selected, as a side benefit (previously every section
 *  fetched on page load regardless of whether you ever looked at it). A vertical list on
 *  desktop (the standard admin-dashboard shape for this many destinations); collapses to a
 *  horizontally-scrollable row on narrow screens, where a fixed-width column would eat too
 *  much of the viewport.
 *
 *  `position: fixed`, not `sticky` — confirmed by hand that `sticky` doesn't work here at all
 *  (scrolls away with the page instead of holding position): Shell.tsx's `<main>` carries
 *  `overflow-x-hidden`, which per the CSS spec forces `overflow-y` to `auto` too, making
 *  `<main>` a sticky-positioning container even though it never actually gets shorter than
 *  its own content — so it never scrolls internally, and a `sticky` element bound to it never
 *  finds anything to stick against while the real, visible scrolling happens on the document
 *  instead. `fixed` escapes that ancestor entirely (only a `transform`/`filter`/`perspective`
 *  ancestor would trap it, and none exists here), so it's pinned to the viewport for real.
 *
 *  Two things a first pass got wrong, fixed here: (1) a hardcoded top offset guessed the
 *  Topbar's height instead of measuring it, so the sidebar started too high and visually
 *  overlapped the page title/banner; this now measures the real `.app-topbar` element with a
 *  ResizeObserver, so it's correct regardless of whether the Topbar wraps to a second row on
 *  a narrower desktop width. (2) the sidebar had no background, so it read as transparent
 *  floating text over whatever page content sat behind it — it's now a solid full-height panel
 *  (own background, right border, spans to the bottom of the viewport) like an actual sidebar,
 *  not a see-through overlay. AdminPage now indents its header/banner too, not just the
 *  section content, so the sidebar reads as a true left column rather than something dropped
 *  on top of the page title. */
function AdminSidebar({ activeId, onSelect }: { activeId: string; onSelect: (id: string) => void }) {
  const topOffset = useTopbarHeight();

  return (
    <nav
      aria-label="Admin sections"
      className="mb-6 md:mb-0 md:fixed md:left-0 md:bottom-0 md:w-[232px] md:overflow-y-auto md:z-10 md:border-r md:border-border md:px-3 md:py-4"
      style={{ top: topOffset, background: "var(--surface)" }}
    >
      <div className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible md:w-full -mx-1 px-1 pb-1 md:pb-0">
        {ADMIN_SECTIONS.map((s) => {
          const active = s.id === activeId;
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => onSelect(s.id)}
              aria-current={active ? "page" : undefined}
              className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-[13px] font-medium whitespace-nowrap shrink-0 md:shrink md:w-full text-left transition-colors ${active ? "" : "hover:bg-surface-sunken"}`}
              style={active ? { color: "#fff", background: "var(--liquor)" } : { color: "var(--text)" }}
            >
              {s.icon}
              {s.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

/** Every Admin Panel section's shell: a colour-banded header (icon, title, subtitle) over a
 *  bordered body, standing in for Settings' plain grey SectionCard specifically here so the
 *  control-panel pages read as a distinct, heavier-weight surface — the way the Filtration
 *  panel's own coloured slicer headers already do elsewhere in this app — rather than as
 *  just another Settings-style page. Local to Admin on purpose: Settings keeps its calmer
 *  SectionCard exactly as is. */
function AdminSectionCard({
  id, icon, accent, title, subtitle, actions, children,
}: {
  id: string;
  icon: React.ReactNode;
  accent: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="mb-7 scroll-mt-28">
      <div
        className="rounded-t-xl px-4 sm:px-5 py-3.5 flex items-start justify-between gap-3 flex-wrap"
        style={{ background: `var(--tile-gradient-${accent})` }}
      >
        <div className="flex items-start gap-2.5 min-w-0">
          <span
            className="flex items-center justify-center w-8 h-8 rounded-lg shrink-0 text-white"
            style={{ background: "rgba(255,255,255,0.18)" }}
          >
            {icon}
          </span>
          <div className="min-w-0 pt-0.5">
            <h2 className="font-display text-[16px] font-semibold text-white m-0 leading-snug">{title}</h2>
            {subtitle && <p className="text-[12px] text-white m-0 mt-0.5 max-w-2xl opacity-80">{subtitle}</p>}
          </div>
        </div>
        {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
      </div>
      <div className="border border-t-0 border-border rounded-b-xl bg-surface p-4 sm:p-5" style={{ boxShadow: "var(--shadow-sm)" }}>
        {children}
      </div>
    </section>
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
    <AdminSectionCard
      id="sales"
      icon={<ReceiptLongOutlinedIcon fontSize="small" />}
      accent={3}
      title="Sales Catalogue Files"
      subtitle="Weekly sale files (data/sales/*.xlsx). Upload a numbered file (e.g. 31.xlsx) to add a sale, or re-upload the same number to replace it — anything else imports as the next sale. There's no delete here: removing a sale means deleting its Excel file from data/sales directly."
    >
      {(error || importError) && (
        <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error ?? importError}</div>
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
        <p className="text-[13px] text-text-muted m-0">No sales loaded yet.</p>
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
                  <td className="px-2 py-2 text-text-muted font-mono text-[12px]">{c.rowCount.toLocaleString()}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[12px]">{new Date(c.importedAt).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
  );
}

/** The MSL archive (data/msl/ — 637 sales of historical auction/private-sale/Tea Board data,
 *  see data/msl/README.md). The folder watcher auto-imports on change, so this is the same
 *  "drop the file in the right place" routine the README documents, just done as an upload
 *  instead of a filesystem copy — see MslController.Upload/UploadBatch for the exact
 *  placement rules. Auction broker files and private-sale PVT files both go through one
 *  batch drop zone: select or drag any mix of .TXT files and .ZIP archives in at once —
 *  kind (auction vs. private), year, sale number and broker are all read back out of each
 *  file's own rows server-side, nothing to type or pick per file, zips are extracted and
 *  validated automatically. Only Tea Board reports (a PDF with no parseable content to
 *  detect year/month from) stay single-file. */
function MslDataSection() {
  const [status, setStatus] = useState<MslStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [year, setYear] = useState("");
  const [month, setMonth] = useState("");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadResult, setUploadResult] = useState<MslScanSummary | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [stagingBusy, setStagingBusy] = useState(false);
  const [stageResult, setStageResult] = useState<MslStageBatchResult | null>(null);
  const [committing, setCommitting] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [committedResult, setCommittedResult] = useState<MslBatchUploadResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const batchInputRef = useRef<HTMLInputElement>(null);
  const [confirmedIds, setConfirmedIds] = useState<Set<string>>(new Set());
  const [confirmDrafts, setConfirmDrafts] = useState<Record<string, string>>({});
  const [filesDialogOpen, setFilesDialogOpen] = useState(false);

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
      const summary = await api.uploadMslFile("teaboard", file, {
        year: year ? Number(year) : undefined,
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

  const stageBatch = async (files: File[]) => {
    const usable = files.filter((f) => {
      const name = f.name.toLowerCase();
      return name.endsWith(".txt") || name.endsWith(".zip");
    });
    if (usable.length === 0) {
      setError("No .TXT or .ZIP files in that selection.");
      return;
    }
    setError(null);
    setCommittedResult(null);
    setConfirmedIds(new Set());
    setConfirmDrafts({});
    setStagingBusy(true);
    try {
      const result = await api.stageMslFilesBatch(usable);
      setStageResult(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setStagingBusy(false);
    }
  };

  const onBatchFilesChosen = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (files.length > 0) await stageBatch(files);
  };

  const removeStagedFile = (stagingId: string) => {
    setStageResult((r) => (r ? { ...r, files: r.files.filter((f) => f.stagingId !== stagingId) } : r));
  };

  const confirmReplace = (stagingId: string, token: string) => {
    if (confirmDrafts[stagingId]?.trim() !== token) return;
    setConfirmedIds((s) => new Set(s).add(stagingId));
  };

  const keepableStagedFiles = () =>
    (stageResult?.files ?? []).filter((f) => !f.error && (!f.requiresConfirmation || confirmedIds.has(f.stagingId)));

  const commitBatch = async () => {
    if (!stageResult) return;
    const keep = keepableStagedFiles().map((f) => f.stagingId);
    if (keep.length === 0) {
      // Nothing left to import — same as cancelling.
      await discardBatch();
      return;
    }
    setError(null);
    setCommitting(true);
    try {
      const result = await api.commitMslBatch(stageResult.batchId, keep);
      setCommittedResult(result);
      setStageResult(null);
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setCommitting(false);
    }
  };

  const discardBatch = async () => {
    if (!stageResult) return;
    setDiscarding(true);
    try {
      await api.discardMslBatch(stageResult.batchId);
    } catch {
      // Abandoned batches expire on their own — a failed discard call isn't worth blocking on.
    } finally {
      setStageResult(null);
      setDiscarding(false);
    }
  };

  const fieldsValid = year.trim() !== "" && month.trim() !== "";

  return (
    <AdminSectionCard
      id="msl"
      icon={<Inventory2OutlinedIcon fontSize="small" />}
      accent={2}
      title="MSL Archive"
      subtitle="Historical Colombo tea-auction data (data/msl/) — auction sale broker files, private-sale files and Tea Board monthly reports. New sales are typically published weekly; drop that week's files in below (individually or zipped up) as soon as they're available so the archive stays current."
    >
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

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
              <div key={s.label} className="rounded-[var(--radius-lg)] border border-border p-3" style={{ background: "var(--surface-sunken)" }}>
                <p className="font-mono text-[19px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
                  {s.value}
                </p>
                <p className="text-[12px] text-text-muted m-0">{s.label}</p>
              </div>
            ))}
          </div>

          <p className="text-[12px] text-text-muted m-0 mb-3">
            Last scan: {status.lastScanAt ? new Date(status.lastScanAt).toLocaleString() : "never"}
            {status.lastScan && ` · ${status.lastScan.filesImported} file(s) imported, ${status.lastScan.rowsImported.toLocaleString()} row(s), ${status.lastScan.filesRemoved} removed`}
          </p>

          {status.gaps.length > 0 && (
            <div className="mb-4 rounded-[var(--radius-lg)] border border-warn bg-warn-light p-3" style={{ color: "var(--warn)" }}>
              <div className="flex items-center gap-1.5 mb-2">
                <WarningAmberOutlinedIcon fontSize="small" />
                <p className="text-[13px] font-semibold m-0">Missing sale numbers</p>
              </div>
              <p className="text-[12px] m-0 mb-2 opacity-80">
                These sale numbers never arrived as public-auction files, even though later sales did — most likely a week&apos;s upload was skipped or the files weren&apos;t sourced yet.
              </p>
              <div className="flex flex-col gap-1">
                {status.gaps.map((g) => (
                  <p key={g.year} className="text-[13px] m-0">
                    <span className="font-semibold">{g.year}</span>
                    <span className="opacity-80"> (1–{g.maxSaleNo} expected): </span>
                    {g.missingSaleNos.map((n) => (
                      <span
                        key={n}
                        className="inline-block px-1.5 py-0.5 mr-1 rounded font-mono text-[11px]"
                        style={{ background: "var(--paper-0)" }}
                      >
                        {n}
                      </span>
                    ))}
                  </p>
                ))}
              </div>
            </div>
          )}

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
                      <td className="px-2 py-2 text-text-muted font-mono text-[12px]">{y.sales}</td>
                      <td className="px-2 py-2 text-text-muted font-mono text-[12px]">{y.lots.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {/* ---- Auction + private-sale files, all auto-detected, drag-and-drop, zip-aware ---- */}
      <div className="border-t border-border pt-3 mb-4">
        <div className="flex items-center justify-between gap-2 mb-0.5">
          <p className="text-[13px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
            Auction &amp; private-sale files
          </p>
          <Button size="small" onClick={() => setFilesDialogOpen(true)}>
            Browse Archive Files
          </Button>
        </div>
        <p className="text-[12px] text-text-muted m-0 mb-2">
          Drop in any mix of broker files, private-sale PVT files, or .ZIP archives containing either — all at once. Kind, year, sale number and broker are all read straight out of each file&apos;s own rows. Nothing is imported until you review the list below and confirm.
        </p>

        {!stageResult ? (
          <div
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragOver(false);
              void stageBatch(Array.from(e.dataTransfer.files));
            }}
            onClick={() => batchInputRef.current?.click()}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") batchInputRef.current?.click(); }}
            className="flex flex-col items-center justify-center gap-2 rounded-[var(--radius-lg)] border-2 border-dashed cursor-pointer py-6 px-4 text-center transition-colors"
            style={{
              borderColor: dragOver ? "var(--brand-gold)" : "var(--border)",
              background: dragOver ? "color-mix(in srgb, var(--brand-gold) 8%, transparent)" : "var(--surface-sunken)",
            }}
          >
            {stagingBusy ? (
              <>
                <TeaLoader size={32} />
                <p className="text-[13px] text-text-muted m-0">Reading files…</p>
              </>
            ) : (
              <>
                <CloudUploadOutlinedIcon sx={{ color: "var(--text-muted)" }} />
                <p className="text-[13px] m-0">
                  <span className="font-medium" style={{ color: "var(--brand-gold)" }}>Click to browse</span> or drag .TXT / .ZIP files here
                </p>
              </>
            )}
            <input ref={batchInputRef} type="file" className="hidden" accept=".txt,.zip" multiple onChange={onBatchFilesChosen} />
          </div>
        ) : (
          <div className="rounded-[var(--radius-lg)] border border-border overflow-hidden">
            <div className="px-3 py-2 flex items-center justify-between gap-2" style={{ background: "var(--surface-sunken)" }}>
              <p className="text-[13px] m-0">
                <span className="font-semibold">{stageResult.files.length}</span> file(s) detected — review below, remove anything you don&apos;t want, then confirm.
              </p>
            </div>
            <div className="overflow-x-auto max-h-[360px] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">File</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Kind</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Broker</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Sale</th>
                    <th className="text-right px-2 py-1.5 font-medium text-text-muted">Rows</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Notes</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {stageResult.files.map((f) => (
                    <tr key={f.stagingId} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5 font-mono text-[12px]">
                        {f.fileName}
                        {f.sourceZip && <span className="block text-text-muted">from {f.sourceZip}</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {f.kind === "private" ? "Private" : f.kind === "auction" ? "Auction" : "—"}
                      </td>
                      <td className="px-2 py-1.5">{f.broker ?? "—"}</td>
                      <td className="px-2 py-1.5 text-text-muted">
                        {f.kind === "private" && f.year
                          ? `PVT ${f.year}`
                          : f.year && f.saleNo
                            ? `${f.saleNo}/${f.year}`
                            : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[12px]">{f.rows.toLocaleString()}</td>
                      <td className="px-2 py-1.5" style={{ minWidth: f.requiresConfirmation && !confirmedIds.has(f.stagingId) ? 260 : undefined }}>
                        {f.error ? (
                          <span style={{ color: "var(--danger)" }}>{f.error}</span>
                        ) : f.requiresConfirmation && !confirmedIds.has(f.stagingId) ? (
                          <div className="flex flex-col gap-1">
                            <span className="inline-flex items-center gap-1 font-medium" style={{ color: "var(--danger)" }}>
                              <WarningAmberOutlinedIcon sx={{ fontSize: 15 }} /> {f.replaceDetail}
                            </span>
                            <div className="flex items-center gap-1.5">
                              <TextField
                                size="small"
                                placeholder={`Type ${f.confirmToken}`}
                                value={confirmDrafts[f.stagingId] ?? ""}
                                onChange={(e) => setConfirmDrafts((d) => ({ ...d, [f.stagingId]: e.target.value }))}
                                onKeyDown={(e) => { if (e.key === "Enter" && f.confirmToken) confirmReplace(f.stagingId, f.confirmToken); }}
                                sx={{ width: 110 }}
                              />
                              <Button
                                size="small"
                                color="error"
                                variant="outlined"
                                disabled={!f.confirmToken || confirmDrafts[f.stagingId]?.trim() !== f.confirmToken}
                                onClick={() => f.confirmToken && confirmReplace(f.stagingId, f.confirmToken)}
                              >
                                Confirm
                              </Button>
                            </div>
                          </div>
                        ) : f.requiresConfirmation ? (
                          <span className="inline-flex items-center gap-1" style={{ color: "var(--sage-dark)" }}>
                            <CheckCircleOutlinedIcon sx={{ fontSize: 15 }} /> Confirmed replace
                          </span>
                        ) : f.willReplace ? (
                          <Tooltip title={f.replaceDetail ?? ""}>
                            <span className="inline-flex items-center gap-1" style={{ color: "var(--warn)" }}>
                              <WarningAmberOutlinedIcon sx={{ fontSize: 15 }} /> Will replace
                            </span>
                          </Tooltip>
                        ) : (
                          <span style={{ color: "var(--sage-dark)" }}>Ready</span>
                        )}
                      </td>
                      <td className="px-2 py-1.5">
                        <Tooltip title="Remove this file from the upload">
                          <IconButton size="small" onClick={() => removeStagedFile(f.stagingId)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="px-3 py-2.5 flex items-center justify-end gap-2 border-t border-border">
              <Button size="small" onClick={discardBatch} disabled={committing || discarding}>
                {discarding ? "Cancelling…" : "Cancel"}
              </Button>
              <Button
                size="small"
                variant="contained"
                onClick={commitBatch}
                disabled={committing || discarding || stageResult.files.length === 0}
              >
                {committing ? "Importing…" : `Import ${keepableStagedFiles().length} File(s)`}
              </Button>
            </div>
          </div>
        )}

        {committedResult && (
          <div className="mt-3">
            <div
              className="mb-2 p-2.5 rounded-[var(--radius-lg)] border text-[13px]"
              style={
                committedResult.files.some((f) => f.error)
                  ? { borderColor: "var(--warn)", background: "var(--warn-light)", color: "var(--warn)" }
                  : { borderColor: "var(--sage)", background: "var(--sage-light)", color: "var(--sage-dark)" }
              }
            >
              {committedResult.files.filter((f) => !f.error).length} of {committedResult.files.length} file(s) imported, {committedResult.scan.rowsImported.toLocaleString()} row(s) total.
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">File</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Kind</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Broker</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Sale</th>
                    <th className="text-right px-2 py-1.5 font-medium text-text-muted">Rows</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {committedResult.files.map((f, i) => (
                    <tr key={i} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5 font-mono text-[12px]">
                        {f.fileName}
                        {f.sourceZip && <span className="block text-text-muted">from {f.sourceZip}</span>}
                      </td>
                      <td className="px-2 py-1.5">
                        {f.kind === "private" ? "Private" : f.kind === "auction" ? "Auction" : "—"}
                      </td>
                      <td className="px-2 py-1.5">{f.broker ?? "—"}</td>
                      <td className="px-2 py-1.5 text-text-muted">
                        {f.kind === "private" && f.year
                          ? `PVT ${f.year}`
                          : f.year && f.saleNo
                            ? `${f.saleNo}/${f.year}`
                            : "—"}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[12px]">{f.rows.toLocaleString()}</td>
                      <td className="px-2 py-1.5">
                        {f.error ? (
                          <span style={{ color: "var(--danger)" }}>{f.error}</span>
                        ) : (
                          <span style={{ color: "var(--sage-dark)" }}>Imported</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      <MslFilesBrowser open={filesDialogOpen} onClose={() => setFilesDialogOpen(false)} onChanged={refresh} />

      {uploadResult && (
        <div className="mb-3 p-2.5 rounded border border-sage bg-sage-light text-[13px]" style={{ color: "var(--sage-dark)" }}>
          {uploadResult.filesImported} file(s) imported, {uploadResult.rowsImported.toLocaleString()} row(s).
          {uploadResult.errors.length > 0 && ` ${uploadResult.errors.length} error(s): ${uploadResult.errors.join("; ")}`}
        </div>
      )}

      {/* ---- Tea Board report: the one file type left that can't self-describe its
           year/month from parseable content, so it stays a manual single upload. ---- */}
      <div className="border-t border-border pt-3">
        <p className="text-[12px] text-text-muted m-0 mb-2">Tea Board report (.pdf)</p>
        <div className="flex flex-wrap items-end gap-2 mb-3">
          <TextField label="Year" size="small" type="number" value={year} onChange={(e) => setYear(e.target.value)} sx={{ width: 100 }} />
          <TextField label="Month" size="small" type="number" value={month} onChange={(e) => setMonth(e.target.value)} sx={{ width: 100 }} />

          <input ref={fileInputRef} type="file" className="hidden" accept=".pdf" onChange={onFileChosen} />
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
    </AdminSectionCard>
  );
}

/** The archive-side counterpart to the upload review list: browse everything already
 *  imported (not just what's mid-upload) and remove something if it shouldn't be there.
 *  Deleting only ever touches the file on disk — the importer's own next scan is what drops
 *  that file's rows from MongoDB (see MslController.DeleteFile's doc comment), so this stays
 *  a thin list + confirm dialog rather than any bespoke Mongo-deletion logic. */
function MslFilesBrowser({ open, onClose, onChanged }: { open: boolean; onClose: () => void; onChanged: () => void }) {
  const [files, setFiles] = useState<MslTrackedFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"all" | "auction" | "private" | "teaboard">("all");
  const [confirmPath, setConfirmPath] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!open) return;
    api
      .listMslFiles()
      .then((list) => {
        setFiles(list);
        setError(null);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load files"));
  }, [open]);

  const filtered = (files ?? []).filter((f) => {
    if (kindFilter !== "all" && f.kind !== kindFilter) return false;
    if (search && !f.relativePath.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

  const confirmFile = filtered.find((f) => f.relativePath === confirmPath) ?? files?.find((f) => f.relativePath === confirmPath);

  const doDelete = async () => {
    if (!confirmPath) return;
    setDeleting(true);
    setError(null);
    try {
      await api.deleteMslFile(confirmPath);
      setFiles((list) => (list ?? []).filter((f) => f.relativePath !== confirmPath));
      setConfirmPath(null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove that file");
    } finally {
      setDeleting(false);
    }
  };

  return (
    <>
      <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
        <DialogTitle>Archive Files</DialogTitle>
        <DialogContent>
          {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}
          <div className="flex flex-wrap gap-2 mb-3">
            <TextField
              size="small"
              placeholder="Search filename or path…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              sx={{ minWidth: 220 }}
            />
            <Select size="small" value={kindFilter} onChange={(e) => setKindFilter(e.target.value as typeof kindFilter)} sx={{ minWidth: 150 }}>
              <MenuItem value="all">All kinds</MenuItem>
              <MenuItem value="auction">Auction</MenuItem>
              <MenuItem value="private">Private</MenuItem>
              <MenuItem value="teaboard">Tea Board</MenuItem>
            </Select>
          </div>

          {files === null ? (
            <div className="flex justify-center py-8">
              <TeaLoader size={36} />
            </div>
          ) : filtered.length === 0 ? (
            <p className="text-[13px] text-text-muted m-0 py-6 text-center">No files match.</p>
          ) : (
            <div className="overflow-x-auto max-h-[50vh] overflow-y-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Path</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Kind</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Sale</th>
                    <th className="text-right px-2 py-1.5 font-medium text-text-muted">Rows</th>
                    <th className="text-left px-2 py-1.5 font-medium text-text-muted">Imported</th>
                    <th className="px-2 py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((f) => (
                    <tr key={f.relativePath} className="border-b border-border last:border-0">
                      <td className="px-2 py-1.5 font-mono text-[12px]">
                        {f.relativePath}
                        {f.error && <span className="block" style={{ color: "var(--danger)" }}>{f.error}</span>}
                      </td>
                      <td className="px-2 py-1.5 capitalize">{f.kind}</td>
                      <td className="px-2 py-1.5 text-text-muted">
                        {f.kind === "private" && f.year
                          ? `PVT ${f.year}`
                          : f.kind === "teaboard" && f.year && f.saleNo
                            ? `${String(f.saleNo).padStart(2, "0")}/${f.year}`
                            : f.year && f.saleNo
                              ? `${f.saleNo}/${f.year}`
                              : (f.year ?? "—")}
                      </td>
                      <td className="px-2 py-1.5 text-right font-mono text-[12px]">{f.rowCount.toLocaleString()}</td>
                      <td className="px-2 py-1.5 text-text-muted">{new Date(f.importedAt).toLocaleDateString()}</td>
                      <td className="px-2 py-1.5">
                        <Tooltip title="Remove this file from the archive">
                          <IconButton size="small" onClick={() => setConfirmPath(f.relativePath)}>
                            <DeleteOutlineIcon fontSize="small" sx={{ color: "var(--danger)" }} />
                          </IconButton>
                        </Tooltip>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={onClose}>Close</Button>
        </DialogActions>
      </Dialog>

      <Dialog open={confirmPath !== null} onClose={() => setConfirmPath(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Remove this file?</DialogTitle>
        <DialogContent>
          <p className="text-[13px] m-0">
            This deletes <span className="font-mono">{confirmPath}</span> from the archive
            {confirmFile ? ` and removes its ${confirmFile.rowCount.toLocaleString()} imported row(s)` : ""} from the database. This
            can&apos;t be undone unless you still have the original file to re-upload.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmPath(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={doDelete} disabled={deleting}>
            {deleting ? "Removing…" : "Remove Permanently"}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

const MARKET_PULSE_CATEGORIES: { value: MarketPulseCategory; label: string }[] = [
  { value: "TeaMarket", label: "Tea Market" },
  { value: "ShippingLogistics", label: "Shipping & Logistics" },
  { value: "CurrencyTrade", label: "Currency & Trade" },
  { value: "WeatherCrop", label: "Weather & Crop" },
  { value: "GlobalEconomy", label: "Global Economy" },
];

type SourceFormState = { name: string; feedUrl: string; category: MarketPulseCategory; enabled: boolean };
const EMPTY_SOURCE_FORM: SourceFormState = { name: "", feedUrl: "", category: "TeaMarket", enabled: true };

/** Market Pulse's admin surface: the RSS source list the ingestion job polls on its own
 *  schedule (see MarketPulseIngestionService), plus a manual "run it now" button so adding
 *  a source doesn't mean waiting up to an hour to see whether it actually works. Every
 *  add/edit/delete/refresh here writes to the same audit log every other admin action
 *  does — see MarketPulseController. */
function NewsSourcesSection() {
  const [sources, setSources] = useState<MarketPulseSource[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<SourceFormState>(EMPTY_SOURCE_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<MarketPulseSource | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);

  const refresh = () => {
    api
      .listMarketPulseSources()
      .then(setSources)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load news sources"));
  };

  useEffect(() => {
    refresh();
  }, []);

  const openAdd = () => {
    setEditingId(null);
    setForm(EMPTY_SOURCE_FORM);
    setFormOpen(true);
  };
  const openEdit = (s: MarketPulseSource) => {
    setEditingId(s.id);
    setForm({ name: s.name, feedUrl: s.feedUrl, category: s.category, enabled: s.enabled });
    setFormOpen(true);
  };

  const save = async () => {
    if (!form.name.trim() || !form.feedUrl.trim()) return;
    setSaving(true);
    setError(null);
    try {
      if (editingId) {
        await api.updateMarketPulseSource(editingId, form);
      } else {
        await api.addMarketPulseSource(form);
      }
      setFormOpen(false);
      refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save this source");
    } finally {
      setSaving(false);
    }
  };

  const toggleEnabled = async (s: MarketPulseSource) => {
    setSources((list) => (list ?? []).map((x) => (x.id === s.id ? { ...x, enabled: !s.enabled } : x)));
    try {
      await api.updateMarketPulseSource(s.id, { enabled: !s.enabled });
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update this source");
      refresh();
    }
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.deleteMarketPulseSource(deleteTarget.id);
      setSources((list) => (list ?? []).filter((s) => s.id !== deleteTarget.id));
      setDeleteTarget(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't remove this source");
    } finally {
      setDeleting(false);
    }
  };

  const runNow = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const summary = await api.refreshMarketPulse();
      setRefreshMessage(
        `${summary.sourcesChecked} source(s) checked${summary.sourcesFailed > 0 ? ` (${summary.sourcesFailed} failed)` : ""}, ${summary.newItems} new item(s), ${summary.scored} scored.`
      );
      refresh();
    } catch (e) {
      setRefreshMessage(e instanceof ApiError ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <AdminSectionCard
      id="newssources"
      icon={<NewspaperOutlinedIcon fontSize="small" />}
      accent={1}
      title="News Sources"
      subtitle="RSS feeds Market Pulse polls for tea, shipping and trade news. A disabled source is skipped on the next scheduled run — no redeploy needed."
      actions={
        <>
          <Button size="small" variant="outlined" startIcon={<RefreshOutlinedIcon fontSize="small" />} onClick={runNow} disabled={refreshing} sx={{ color: "#fff", borderColor: "rgba(255,255,255,0.5)" }}>
            {refreshing ? "Running…" : "Run Now"}
          </Button>
          <Button size="small" variant="contained" startIcon={<AddOutlinedIcon fontSize="small" />} onClick={openAdd} sx={{ background: "rgba(255,255,255,0.2)" }}>
            Add Source
          </Button>
        </>
      }
    >
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}
      {refreshMessage && (
        <div className="mb-3 p-2.5 rounded border border-border text-[13px]" style={{ background: "var(--surface-sunken)" }}>
          {refreshMessage}
        </div>
      )}

      {sources === null ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : sources.length === 0 ? (
        <p className="text-[13px] text-text-muted m-0">No sources yet — add one to start pulling news.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Feed URL</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Category</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Enabled</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Last Fetch</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {sources.map((s) => (
                <tr key={s.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{s.name}</td>
                  <td className="px-2 py-2 font-mono text-[12px] text-text-muted max-w-[280px] truncate" title={s.feedUrl}>
                    {s.feedUrl}
                  </td>
                  <td className="px-2 py-2 text-text-muted">{MARKET_PULSE_CATEGORIES.find((c) => c.value === s.category)?.label ?? s.category}</td>
                  <td className="px-2 py-2">
                    <Switch size="small" checked={s.enabled} onChange={() => toggleEnabled(s)} />
                  </td>
                  <td className="px-2 py-2 text-[12px]">
                    {s.lastFetchedAt ? (
                      s.lastFetchSucceeded ? (
                        <span style={{ color: "var(--sage-dark)" }}>{s.lastFetchNewItems} new · {new Date(s.lastFetchedAt).toLocaleString()}</span>
                      ) : (
                        <span style={{ color: "var(--danger)" }} title={s.lastFetchError ?? ""}>
                          Failed · {new Date(s.lastFetchedAt).toLocaleString()}
                        </span>
                      )
                    ) : (
                      <span className="text-text-muted">Never fetched</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex items-center gap-1 justify-end">
                      <Tooltip title="Edit">
                        <IconButton size="small" onClick={() => openEdit(s)}>
                          <EditOutlinedIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                      <Tooltip title="Delete">
                        <IconButton size="small" onClick={() => setDeleteTarget(s)}>
                          <DeleteOutlineIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Dialog open={formOpen} onClose={() => setFormOpen(false)} maxWidth="sm" fullWidth>
        <DialogTitle>{editingId ? "Edit Source" : "Add Source"}</DialogTitle>
        <DialogContent>
          <div className="flex flex-col gap-3 pt-1">
            <TextField label="Name" size="small" fullWidth value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            <TextField
              label="Feed URL"
              size="small"
              fullWidth
              placeholder="https://example.com/feed"
              value={form.feedUrl}
              onChange={(e) => setForm((f) => ({ ...f, feedUrl: e.target.value }))}
            />
            <Select
              size="small"
              value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as MarketPulseCategory }))}
            >
              {MARKET_PULSE_CATEGORIES.map((c) => (
                <MenuItem key={c.value} value={c.value}>
                  {c.label}
                </MenuItem>
              ))}
            </Select>
            <FormControlLabel
              control={<Checkbox checked={form.enabled} onChange={(e) => setForm((f) => ({ ...f, enabled: e.target.checked }))} />}
              label="Enabled"
            />
          </div>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setFormOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button variant="contained" onClick={save} disabled={saving || !form.name.trim() || !form.feedUrl.trim()}>
            {saving ? "Saving…" : editingId ? "Save Changes" : "Add Source"}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="sm" fullWidth>
        <DialogTitle>Remove this source?</DialogTitle>
        <DialogContent>
          <p className="text-[13px] m-0">
            This stops <span className="font-semibold">{deleteTarget?.name}</span> from being polled. Items already pulled from it stay in the feed.
          </p>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteTarget(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={doDelete} disabled={deleting}>
            {deleting ? "Removing…" : "Remove"}
          </Button>
        </DialogActions>
      </Dialog>
    </AdminSectionCard>
  );
}

const EMPTY_INTELLIGENCE: LandingIntelligenceItem = { title: "", description: "", iconKey: "document", order: 1 };
const EMPTY_TESTIMONIAL: LandingTestimonial = { id: "", name: "", role: "", quote: "", avatarUrl: "", order: 1, isPublished: true };
const EMPTY_PLATFORM_STAT: LandingPlatformStat = { label: "", value: "", isLive: false, liveSourceKey: null };

/** The public /home page's CMS — every field here is what an unauthenticated visitor sees,
 *  so this is a plain full-replace editor (load, edit, Save writes the whole document back)
 *  rather than per-field autosave. List rows (intelligences/testimonials/stats) use a numeric
 *  Order field instead of drag-and-drop — a deliberate scope trim, see the feature's plan. */
function LandingPageSection() {
  const [content, setContent] = useState<LandingPageContent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);

  useEffect(() => {
    api
      .getLandingContentForAdmin()
      .then(setContent)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load landing page content"));
  }, []);

  const save = async () => {
    if (!content) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    try {
      const updated = await api.updateLandingContent(content);
      setContent(updated);
      setSavedMessage(`Saved · ${new Date(updated.updatedAt).toLocaleString()}${updated.updatedBy ? ` by ${updated.updatedBy}` : ""}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't save landing page content");
    } finally {
      setSaving(false);
    }
  };

  if (!content) {
    return (
      <AdminSectionCard id="landing" icon={<LanguageOutlinedIcon fontSize="small" />} accent={6} title="Landing Page" subtitle="The public marketing page at /home.">
        {error ? (
          <div className="p-2.5 rounded border border-danger bg-danger-light text-[13px] text-danger">{error}</div>
        ) : (
          <div className="flex justify-center py-8"><TeaLoader size={40} /></div>
        )}
      </AdminSectionCard>
    );
  }

  const inputCls = "w-full text-[13px] px-2.5 py-2 rounded border border-border bg-surface";

  return (
    <AdminSectionCard
      id="landing"
      icon={<LanguageOutlinedIcon fontSize="small" />}
      accent={6}
      title="Landing Page"
      subtitle="Every field on the public /home page — hero copy, company stats, the 5 Intelligences grid, testimonials and heritage copy. Nothing here needs a deploy."
      actions={
        <Button
          size="small"
          variant="contained"
          onClick={save}
          disabled={saving || !content.hero.headline.trim() || !content.hero.subhead.trim() || !content.heritage.pullQuote.trim()}
          sx={{ background: "rgba(255,255,255,0.2)" }}
        >
          {saving ? "Saving…" : "Save"}
        </Button>
      }
    >
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}
      {savedMessage && <div className="mb-3 p-2.5 rounded border border-border text-[13px]" style={{ background: "var(--surface-sunken)" }}>{savedMessage}</div>}

      {/* Hero */}
      <h3 className="text-[13px] font-semibold mb-2.5">Hero</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <input className={inputCls} placeholder="Headline" value={content.hero.headline}
          onChange={(e) => setContent({ ...content, hero: { ...content.hero, headline: e.target.value } })} />
        <input className={inputCls} placeholder="Primary CTA label" value={content.hero.ctaPrimaryLabel}
          onChange={(e) => setContent({ ...content, hero: { ...content.hero, ctaPrimaryLabel: e.target.value } })} />
        <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Subhead" value={content.hero.subhead}
          onChange={(e) => setContent({ ...content, hero: { ...content.hero, subhead: e.target.value } })} />
        <input className={inputCls} placeholder="Secondary CTA label" value={content.hero.ctaSecondaryLabel}
          onChange={(e) => setContent({ ...content, hero: { ...content.hero, ctaSecondaryLabel: e.target.value } })} />
      </div>

      {/* Company stats */}
      <h3 className="text-[13px] font-semibold mb-2.5">Company Stats</h3>
      <p className="text-[12px] text-text-muted mb-2.5">Real, sourced Asia Siyaka figures — keep these accurate, not aspirational.</p>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-3">
        <input className={inputCls} type="number" placeholder="Founded year" value={content.companyStats.foundedYear}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, foundedYear: Number(e.target.value) } })} />
        <input className={inputCls} type="number" placeholder="Years operating" value={content.companyStats.yearsOperating}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, yearsOperating: Number(e.target.value) } })} />
        <input className={inputCls} type="number" placeholder="Employee count" value={content.companyStats.employeeCount}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, employeeCount: Number(e.target.value) } })} />
        <input className={inputCls} type="number" placeholder="Warehouse count" value={content.companyStats.warehouseCount}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, warehouseCount: Number(e.target.value) } })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
        <input className={inputCls} placeholder="Ranking (e.g. Top 4 tea broker in Sri Lanka)" value={content.companyStats.ranking}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, ranking: e.target.value } })} />
        <input className={inputCls} placeholder="Market share label" value={content.companyStats.marketShareLabel}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, marketShareLabel: e.target.value } })} />
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
        <textarea className={inputCls} rows={2} placeholder="Vision" value={content.companyStats.vision}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, vision: e.target.value } })} />
        <textarea className={inputCls} rows={2} placeholder="Mission" value={content.companyStats.mission}
          onChange={(e) => setContent({ ...content, companyStats: { ...content.companyStats, mission: e.target.value } })} />
      </div>

      {/* Heritage */}
      <h3 className="text-[13px] font-semibold mb-2.5">Ceylon Tea Heritage</h3>
      <div className="grid grid-cols-1 gap-3 mb-6">
        <input className={inputCls} placeholder="Pull quote" value={content.heritage.pullQuote}
          onChange={(e) => setContent({ ...content, heritage: { ...content.heritage, pullQuote: e.target.value } })} />
        <textarea className={inputCls} rows={2} placeholder="Body copy" value={content.heritage.bodyCopy}
          onChange={(e) => setContent({ ...content, heritage: { ...content.heritage, bodyCopy: e.target.value } })} />
        <input className={inputCls} placeholder="Image URL (e.g. /tea/intro/plucking-nuwara-eliya.webp)" value={content.heritage.imageUrl}
          onChange={(e) => setContent({ ...content, heritage: { ...content.heritage, imageUrl: e.target.value } })} />
      </div>

      {/* 5 Intelligences */}
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-semibold m-0">5 Intelligences</h3>
        <Button size="small" startIcon={<AddOutlinedIcon fontSize="small" />}
          onClick={() => setContent({ ...content, fiveIntelligences: [...content.fiveIntelligences, { ...EMPTY_INTELLIGENCE, order: content.fiveIntelligences.length + 1 }] })}>
          Add
        </Button>
      </div>
      <div className="flex flex-col gap-2 mb-6">
        {content.fiveIntelligences.map((item, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[60px_1fr_1fr_100px_36px] gap-2 items-start p-2 rounded border border-border">
            <input className={inputCls} type="number" placeholder="Order" value={item.order}
              onChange={(e) => setContent({ ...content, fiveIntelligences: content.fiveIntelligences.map((x, xi) => xi === i ? { ...x, order: Number(e.target.value) } : x) })} />
            <input className={inputCls} placeholder="Title" value={item.title}
              onChange={(e) => setContent({ ...content, fiveIntelligences: content.fiveIntelligences.map((x, xi) => xi === i ? { ...x, title: e.target.value } : x) })} />
            <input className={inputCls} placeholder="Description" value={item.description}
              onChange={(e) => setContent({ ...content, fiveIntelligences: content.fiveIntelligences.map((x, xi) => xi === i ? { ...x, description: e.target.value } : x) })} />
            <select className={inputCls} value={item.iconKey}
              onChange={(e) => setContent({ ...content, fiveIntelligences: content.fiveIntelligences.map((x, xi) => xi === i ? { ...x, iconKey: e.target.value } : x) })}>
              {/* Must match the ICON/GRADIENT maps in components/landing/FiveIntelligences.tsx —
                  a free-text key here used to silently fall back to a generic icon on typos. */}
              <option value="document">Document</option>
              <option value="valuation">Valuation</option>
              <option value="knowledge">Knowledge</option>
              <option value="market">Market</option>
              <option value="assistant">Assistant</option>
            </select>
            <IconButton size="small" onClick={() => setContent({ ...content, fiveIntelligences: content.fiveIntelligences.filter((_, xi) => xi !== i) })}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </div>
        ))}
      </div>

      {/* Testimonials */}
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-semibold m-0">Testimonials</h3>
        <Button size="small" startIcon={<AddOutlinedIcon fontSize="small" />}
          onClick={() => setContent({ ...content, testimonials: [...content.testimonials, { ...EMPTY_TESTIMONIAL, id: crypto.randomUUID(), order: content.testimonials.length + 1 }] })}>
          Add
        </Button>
      </div>
      <div className="flex flex-col gap-2 mb-6">
        {content.testimonials.map((t, i) => (
          <div key={i} className="flex flex-col gap-2 p-2 rounded border border-border">
            <div className="grid grid-cols-1 sm:grid-cols-[60px_1fr_1fr_80px_36px] gap-2 items-center">
              <input className={inputCls} type="number" placeholder="Order" value={t.order}
                onChange={(e) => setContent({ ...content, testimonials: content.testimonials.map((x, xi) => xi === i ? { ...x, order: Number(e.target.value) } : x) })} />
              <input className={inputCls} placeholder="Name" value={t.name}
                onChange={(e) => setContent({ ...content, testimonials: content.testimonials.map((x, xi) => xi === i ? { ...x, name: e.target.value } : x) })} />
              <input className={inputCls} placeholder="Role" value={t.role}
                onChange={(e) => setContent({ ...content, testimonials: content.testimonials.map((x, xi) => xi === i ? { ...x, role: e.target.value } : x) })} />
              <FormControlLabel control={<Switch size="small" checked={t.isPublished}
                onChange={(e) => setContent({ ...content, testimonials: content.testimonials.map((x, xi) => xi === i ? { ...x, isPublished: e.target.checked } : x) })} />}
                label="Live" sx={{ m: 0 }} />
              <IconButton size="small" onClick={() => setContent({ ...content, testimonials: content.testimonials.filter((_, xi) => xi !== i) })}>
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </div>
            <textarea className={inputCls} rows={2} placeholder="Quote" value={t.quote}
              onChange={(e) => setContent({ ...content, testimonials: content.testimonials.map((x, xi) => xi === i ? { ...x, quote: e.target.value } : x) })} />
            <input className={inputCls} placeholder="Avatar URL (optional — shows initials if left blank)" value={t.avatarUrl}
              onChange={(e) => setContent({ ...content, testimonials: content.testimonials.map((x, xi) => xi === i ? { ...x, avatarUrl: e.target.value } : x) })} />
          </div>
        ))}
      </div>

      {/* Platform stats */}
      <div className="flex items-center justify-between mb-2.5">
        <h3 className="text-[13px] font-semibold m-0">Live Metrics Strip</h3>
        <Button size="small" startIcon={<AddOutlinedIcon fontSize="small" />}
          onClick={() => setContent({ ...content, platformStats: [...content.platformStats, EMPTY_PLATFORM_STAT] })}>
          Add
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {content.platformStats.map((s, i) => (
          <div key={i} className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_90px_36px] gap-2 items-center p-2 rounded border border-border">
            <input className={inputCls} placeholder="Label" value={s.label}
              onChange={(e) => setContent({ ...content, platformStats: content.platformStats.map((x, xi) => xi === i ? { ...x, label: e.target.value } : x) })} />
            <input className={inputCls} placeholder="Value (e.g. 12,400 or 99.2%)" value={s.value} disabled={s.isLive}
              onChange={(e) => setContent({ ...content, platformStats: content.platformStats.map((x, xi) => xi === i ? { ...x, value: e.target.value } : x) })} />
            <Tooltip title="Override with a real platform count instead of the value above (currently only 'documentsAnalyzed' is wired)">
              <FormControlLabel control={<Switch size="small" checked={s.isLive}
                onChange={(e) => setContent({ ...content, platformStats: content.platformStats.map((x, xi) => xi === i ? { ...x, isLive: e.target.checked, liveSourceKey: e.target.checked ? (x.liveSourceKey ?? "documentsAnalyzed") : null } : x) })} />}
                label="Live" sx={{ m: 0 }} />
            </Tooltip>
            <IconButton size="small" onClick={() => setContent({ ...content, platformStats: content.platformStats.filter((_, xi) => xi !== i) })}>
              <DeleteOutlineIcon fontSize="small" />
            </IconButton>
          </div>
        ))}
      </div>
    </AdminSectionCard>
  );
}

/** "Request Access" submissions from the public /home page — this app is admin-provisioned
 *  only, so this is the queue an Admin works from before creating a real account in the
 *  Users section below. */
function AccessRequestsSection() {
  const [requests, setRequests] = useState<AccessRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    api.listAccessRequests().then(setRequests).catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load access requests"));
  };
  useEffect(() => { refresh(); }, []);

  const markReviewed = async (id: string) => {
    setRequests((list) => (list ?? []).map((r) => (r.id === id ? { ...r, status: "Reviewed" } : r)));
    try {
      await api.markAccessRequestReviewed(id);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't update this request");
      refresh();
    }
  };

  return (
    <AdminSectionCard id="accessrequests" icon={<HowToRegOutlinedIcon fontSize="small" />} accent={3} title="Access Requests" subtitle="Submissions from the public landing page's Request Access form.">
      {error && <div className="mb-3 p-2.5 rounded border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}
      {requests === null ? (
        <div className="flex justify-center py-8"><TeaLoader size={40} /></div>
      ) : requests.length === 0 ? (
        <p className="text-[13px] text-text-muted m-0">No requests yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Email</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Company</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Message</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Received</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {requests.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{r.name}</td>
                  <td className="px-2 py-2 text-text-muted">{r.email}</td>
                  <td className="px-2 py-2 text-text-muted">{r.company}</td>
                  <td className="px-2 py-2 text-text-muted max-w-[240px] truncate" title={r.message}>{r.message || "—"}</td>
                  <td className="px-2 py-2 text-[12px] text-text-muted">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-2 py-2">
                    {r.status === "Reviewed" ? (
                      <span className="text-[12px]" style={{ color: "var(--sage-dark)" }}>Reviewed</span>
                    ) : (
                      <Button size="small" onClick={() => markReviewed(r.id)}>Mark reviewed</Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminSectionCard>
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
    <AdminSectionCard id="users" icon={<GroupOutlinedIcon fontSize="small" />} accent={5} title="Users" subtitle="Everyone with access to this workspace.">
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

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
                  <td className="px-2 py-2 text-text-muted font-mono text-[12px]">{new Date(u.createdAt).toLocaleDateString()}</td>
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
            {editError && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{editError}</div>}
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
            {addError && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{addError}</div>}
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
    </AdminSectionCard>
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
        <p className="text-[13px] text-danger m-0 mb-3">Copy this now — for security, it won&apos;t be shown again.</p>
        <div className="flex items-center gap-2 p-2.5 rounded border border-border bg-surface-sunken">
          <code className="flex-1 text-[13px] font-mono break-all">{value}</code>
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
    <AdminSectionCard id="apikeys" icon={<VpnKeyOutlinedIcon fontSize="small" />} accent={8} title="API Keys" subtitle="Credentials for external tools (e.g. an n8n workflow) to call this API without a human login.">
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

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
        <p className="text-[13px] text-text-muted m-0">No API keys yet.</p>
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
                  <td className="px-2 py-2 font-mono text-[12px] text-text-muted">{k.keyPrefix}…</td>
                  <td className="px-2 py-2 text-text-muted">{k.roles.join(", ")}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[12px]">
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
            {addError && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{addError}</div>}
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
                <p className="text-[12px] text-text-muted m-0 mb-1">Roles</p>
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
    </AdminSectionCard>
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
    <AdminSectionCard id="webhooks" icon={<LinkOutlinedIcon fontSize="small" />} accent={6} title="Webhooks" subtitle="Notify an external tool (e.g. n8n) when something happens in this app.">
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

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
        <p className="text-[13px] text-text-muted m-0">No webhooks yet.</p>
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
                  <td className="px-2 py-2 font-mono text-[12px]">{w.event}</td>
                  <td className="px-2 py-2 text-text-muted truncate max-w-[520px]">{w.url}</td>
                  <td className="px-2 py-2 text-text-muted font-mono text-[12px]">{new Date(w.createdAt).toLocaleDateString()}</td>
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
            {addError && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{addError}</div>}
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
    </AdminSectionCard>
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
    <AdminSectionCard
      id="masterdata"
      icon={<CategoryOutlinedIcon fontSize="small" />}
      accent={7}
      title="Master Data"
      subtitle="Canonical names for brokers, buyers, gardens, grades and more, so spelling variants across broker files merge into one row instead of splitting reports and analytics."
    >
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

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
        <p className="text-[13px] text-text-muted m-0 mb-4">No canonical {type.toLowerCase()} entities yet.</p>
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
          <p className="text-[13px] text-text-muted m-0">
            Spelling variants for <strong>{type}</strong> still seen in sale files that aren&apos;t mapped to a canonical entity yet.
          </p>
          <Button size="small" onClick={() => scanUnmapped(type)} disabled={unmappedLoading}>
            {unmappedLoading ? "Scanning…" : "Scan"}
          </Button>
        </div>
        {unmappedError && (
          <div className="mb-2 p-2 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[12px] text-danger">{unmappedError}</div>
        )}
        {unmapped.length > 0 && (
          <ul className="m-0 p-0 list-none flex flex-col gap-1 max-h-[240px] overflow-y-auto">
            {unmapped.map((u) => (
              <li key={u.value} className="flex items-center justify-between gap-2 text-[13px] px-2 py-1 rounded bg-surface-sunken">
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
            {formError && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{formError}</div>}
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
    </AdminSectionCard>
  );
}

/** Plantation → Factory → Mark reference hierarchy + the mined broker-history job. Marks
 *  are added from a specific Factory's row ("+ Mark"), matching the natural drill-down order
 *  (pick the factory first) rather than a separate top-level form needing its own factory
 *  search box. Factories/Marks are searched rather than always-listed — there are hundreds
 *  of factories and well over a thousand marks, too many for an always-rendered table like
 *  the CMS-sized lists elsewhere on this page. */
function MarkIntelligenceSection() {
  const [plantations, setPlantations] = useState<Plantation[]>([]);
  const [plantationsLoading, setPlantationsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mining, setMining] = useState(false);
  const [miningResult, setMiningResult] = useState<MiningRunResult | null>(null);
  const [miningError, setMiningError] = useState<string | null>(null);

  const refreshPlantations = () => {
    setPlantationsLoading(true);
    api
      .listPlantations()
      .then(setPlantations)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load plantations"))
      .finally(() => setPlantationsLoading(false));
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refreshPlantations();
  }, []);

  const runMining = async () => {
    setMining(true);
    setMiningError(null);
    try {
      const result = await api.runMarkIntelligenceMining();
      setMiningResult(result);
      refreshPlantations();
    } catch (e) {
      setMiningError(e instanceof ApiError ? e.message : "Mining run failed");
    } finally {
      setMining(false);
    }
  };

  // --- Plantation add/edit dialog ---
  const [plantationDialogOpen, setPlantationDialogOpen] = useState(false);
  const [editingPlantation, setEditingPlantation] = useState<Plantation | null>(null);
  const [plantationName, setPlantationName] = useState("");
  const [plantationActive, setPlantationActive] = useState(true);
  const [plantationBusy, setPlantationBusy] = useState(false);
  const [plantationFormError, setPlantationFormError] = useState<string | null>(null);

  const openCreatePlantation = () => {
    setEditingPlantation(null);
    setPlantationName("");
    setPlantationActive(true);
    setPlantationFormError(null);
    setPlantationDialogOpen(true);
  };
  const openEditPlantation = (p: Plantation) => {
    setEditingPlantation(p);
    setPlantationName(p.name);
    setPlantationActive(p.isActive);
    setPlantationFormError(null);
    setPlantationDialogOpen(true);
  };
  const savePlantation = async (e: React.FormEvent) => {
    e.preventDefault();
    setPlantationBusy(true);
    setPlantationFormError(null);
    try {
      if (editingPlantation) await api.updatePlantation(editingPlantation.id, plantationName.trim(), plantationActive);
      else await api.createPlantation(plantationName.trim());
      setPlantationDialogOpen(false);
      refreshPlantations();
    } catch (err) {
      setPlantationFormError(err instanceof ApiError ? err.message : "Couldn't save that plantation");
    } finally {
      setPlantationBusy(false);
    }
  };
  const deletePlantationRow = async (p: Plantation) => {
    try {
      const result = await api.deletePlantation(p.id);
      if (result?.deactivated) setPlantations((list) => list.map((x) => (x.id === p.id ? { ...x, isActive: false } : x)));
      else setPlantations((list) => list.filter((x) => x.id !== p.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete that plantation");
    }
  };

  // --- Factory search + add/edit dialog ---
  const [factoryQuery, setFactoryQuery] = useState("");
  const [factories, setFactories] = useState<FactoryRecord[]>([]);
  const [factoriesLoading, setFactoriesLoading] = useState(false);
  const [factoryDialogOpen, setFactoryDialogOpen] = useState(false);
  const [editingFactory, setEditingFactory] = useState<FactoryRecord | null>(null);
  const [factoryPlantationId, setFactoryPlantationId] = useState<string>("");
  const [factoryCode, setFactoryCode] = useState("");
  const [factoryName, setFactoryName] = useState("");
  const [factoryActive, setFactoryActive] = useState(true);
  const [factoryBusy, setFactoryBusy] = useState(false);
  const [factoryFormError, setFactoryFormError] = useState<string | null>(null);

  const searchFactories = () => {
    if (!factoryQuery.trim()) {
      setFactories([]);
      return;
    }
    setFactoriesLoading(true);
    // The backend doesn't have a dedicated factory-text-search endpoint yet — reuse the
    // combined mark/factory search and de-duplicate by factory, since every mark result
    // already carries its parent factory's code/name/plantation.
    api
      .searchMarkIntelligence(factoryQuery.trim())
      .then((marks) => {
        const seen = new Map<string, FactoryRecord>();
        for (const m of marks) {
          if (!seen.has(m.factoryId)) {
            seen.set(m.factoryId, { id: m.factoryId, plantationId: m.plantationId, code: m.factoryCode, name: m.factoryName, isActive: true, markCount: 0 });
          }
        }
        setFactories([...seen.values()]);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't search factories"))
      .finally(() => setFactoriesLoading(false));
  };

  const openCreateFactory = (plantationId?: string) => {
    setEditingFactory(null);
    setFactoryPlantationId(plantationId ?? "");
    setFactoryCode("");
    setFactoryName("");
    setFactoryActive(true);
    setFactoryFormError(null);
    setFactoryDialogOpen(true);
  };
  const openEditFactory = (f: FactoryRecord) => {
    setEditingFactory(f);
    setFactoryPlantationId(f.plantationId ?? "");
    setFactoryCode(f.code);
    setFactoryName(f.name);
    setFactoryActive(f.isActive);
    setFactoryFormError(null);
    setFactoryDialogOpen(true);
  };
  const saveFactory = async (e: React.FormEvent) => {
    e.preventDefault();
    setFactoryBusy(true);
    setFactoryFormError(null);
    const pid = factoryPlantationId || null;
    try {
      if (editingFactory) await api.updateFactory(editingFactory.id, pid, factoryCode.trim(), factoryName.trim(), factoryActive);
      else await api.createFactory(pid, factoryCode.trim(), factoryName.trim());
      setFactoryDialogOpen(false);
      if (factoryQuery.trim()) searchFactories();
    } catch (err) {
      setFactoryFormError(err instanceof ApiError ? err.message : "Couldn't save that factory");
    } finally {
      setFactoryBusy(false);
    }
  };
  const deleteFactoryRow = async (f: FactoryRecord) => {
    try {
      const result = await api.deleteFactory(f.id);
      if (result?.deactivated) setFactories((list) => list.map((x) => (x.id === f.id ? { ...x, isActive: false } : x)));
      else setFactories((list) => list.filter((x) => x.id !== f.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete that factory");
    }
  };

  // --- Mark search + add/edit dialog ---
  const [markQuery, setMarkQuery] = useState("");
  const [marks, setMarks] = useState<MarkRecord[]>([]);
  const [marksLoading, setMarksLoading] = useState(false);
  const [markDialogOpen, setMarkDialogOpen] = useState(false);
  const [editingMark, setEditingMark] = useState<MarkRecord | null>(null);
  const [markFactoryId, setMarkFactoryId] = useState("");
  const [markFactoryLabel, setMarkFactoryLabel] = useState("");
  const [markCode, setMarkCode] = useState("");
  const [markName, setMarkName] = useState("");
  const [markStatus, setMarkStatus] = useState<"Active" | "Discontinued">("Active");
  const [markBusy, setMarkBusy] = useState(false);
  const [markFormError, setMarkFormError] = useState<string | null>(null);

  const searchMarks = () => {
    if (!markQuery.trim()) {
      setMarks([]);
      return;
    }
    setMarksLoading(true);
    api
      .searchMarkIntelligence(markQuery.trim())
      .then(setMarks)
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't search marks"))
      .finally(() => setMarksLoading(false));
  };

  const openCreateMarkForFactory = (f: FactoryRecord) => {
    setEditingMark(null);
    setMarkFactoryId(f.id);
    setMarkFactoryLabel(`${f.code} — ${f.name}`);
    setMarkCode("");
    setMarkName("");
    setMarkStatus("Active");
    setMarkFormError(null);
    setMarkDialogOpen(true);
  };
  const openEditMark = (m: MarkRecord) => {
    setEditingMark(m);
    setMarkFactoryId(m.factoryId);
    setMarkFactoryLabel(`${m.factoryCode} — ${m.factoryName}`);
    setMarkCode(m.code);
    setMarkName(m.name);
    setMarkStatus(m.status);
    setMarkFormError(null);
    setMarkDialogOpen(true);
  };
  const saveMark = async (e: React.FormEvent) => {
    e.preventDefault();
    setMarkBusy(true);
    setMarkFormError(null);
    try {
      if (editingMark) await api.updateMark(editingMark.id, markName.trim(), markCode.trim(), markStatus);
      else await api.createMark(markFactoryId, markName.trim(), markCode.trim());
      setMarkDialogOpen(false);
      if (markQuery.trim()) searchMarks();
    } catch (err) {
      setMarkFormError(err instanceof ApiError ? err.message : "Couldn't save that mark");
    } finally {
      setMarkBusy(false);
    }
  };
  const deleteMarkRow = async (m: MarkRecord) => {
    try {
      const result = await api.deleteMark(m.id);
      if (result?.deactivated) setMarks((list) => list.map((x) => (x.id === m.id ? { ...x, status: "Discontinued" } : x)));
      else setMarks((list) => list.filter((x) => x.id !== m.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't delete that mark");
    }
  };

  const inputCls = "w-full text-[13px] px-2.5 py-2 rounded border border-border bg-surface";
  const eraLabel = (era: MarkBrokerEra) =>
    `${era.brokers.join("+")} (${era.startYear}·S${era.startSaleNo}–${era.endYear ? `${era.endYear}·S${era.endSaleNo}` : "present"})`;

  return (
    <AdminSectionCard
      id="markintelligence"
      icon={<AccountTreeOutlinedIcon fontSize="small" />}
      accent={2}
      title="Mark Intelligence"
      subtitle="Plantation → Factory → Mark reference data and which broker(s) currently sell each mark — mined from the MSL auction archive, editable here."
      actions={
        <Button size="small" variant="contained" onClick={runMining} disabled={mining} sx={{ background: "rgba(255,255,255,0.2)" }}>
          {mining ? "Mining…" : "Run Mining"}
        </Button>
      }
    >
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}
      {miningError && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{miningError}</div>}
      {miningResult && (
        <div className="mb-4 p-3 rounded-[var(--radius-lg)] border border-border text-[12.5px]" style={{ background: "var(--surface-sunken)" }}>
          Last run: {miningResult.factoriesSeen} factories, {miningResult.marksSeen} marks ({miningResult.newMarksCreated} new),{" "}
          {miningResult.marksWithMultipleEras} with a detected broker change, {miningResult.marksEverShared} ever shared,{" "}
          {miningResult.marksThatChangedFactory} spanned more than one factory code.
        </div>
      )}

      {/* Plantations */}
      <div className="flex items-center justify-between gap-3 mb-2.5">
        <h3 className="text-[13px] font-semibold m-0">Plantations</h3>
        <Button size="small" startIcon={<AddOutlinedIcon fontSize="small" />} onClick={openCreatePlantation}>
          Add
        </Button>
      </div>
      {plantationsLoading ? (
        <div className="flex justify-center py-6">
          <TeaLoader size={32} />
        </div>
      ) : (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Factories</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {plantations.map((p) => (
                <tr key={p.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2">{p.name}</td>
                  <td className="px-2 py-2 text-text-muted">{p.factoryCount}</td>
                  <td className="px-2 py-2">{p.isActive ? "Active" : <span className="text-text-muted">Inactive</span>}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <IconButton size="small" onClick={() => openEditPlantation(p)} aria-label="Edit">
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => deletePlantationRow(p)} aria-label="Delete">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Factories */}
      <h3 className="text-[13px] font-semibold mb-2.5">Factories</h3>
      <div className="flex items-center gap-2 mb-2.5">
        <TextField
          size="small"
          placeholder="Search factories by code or name…"
          value={factoryQuery}
          onChange={(e) => setFactoryQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchFactories()}
          sx={{ flex: 1 }}
        />
        <Button size="small" onClick={searchFactories} disabled={factoriesLoading}>
          Search
        </Button>
        <Button size="small" startIcon={<AddOutlinedIcon fontSize="small" />} onClick={() => openCreateFactory()}>
          Add
        </Button>
      </div>
      {factoriesLoading ? (
        <div className="flex justify-center py-6">
          <TeaLoader size={32} />
        </div>
      ) : factories.length > 0 ? (
        <div className="overflow-x-auto mb-6">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Code</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Plantation</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {factories.map((f) => (
                <tr key={f.id} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-mono">{f.code}</td>
                  <td className="px-2 py-2">{f.name}</td>
                  <td className="px-2 py-2 text-text-muted">{plantations.find((p) => p.id === f.plantationId)?.name ?? "—"}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <Button size="small" onClick={() => openCreateMarkForFactory(f)}>
                      + Mark
                    </Button>
                    <IconButton size="small" onClick={() => openEditFactory(f)} aria-label="Edit">
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => deleteFactoryRow(f)} aria-label="Delete">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[12.5px] text-text-muted m-0 mb-6">Search for a factory by code or name to edit it, or add one from a plantation.</p>
      )}

      {/* Marks */}
      <h3 className="text-[13px] font-semibold mb-2.5">Marks</h3>
      <div className="flex items-center gap-2 mb-2.5">
        <TextField
          size="small"
          placeholder="Search marks by code or name…"
          value={markQuery}
          onChange={(e) => setMarkQuery(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && searchMarks()}
          sx={{ flex: 1 }}
        />
        <Button size="small" onClick={searchMarks} disabled={marksLoading}>
          Search
        </Button>
      </div>
      {marksLoading ? (
        <div className="flex justify-center py-6">
          <TeaLoader size={32} />
        </div>
      ) : marks.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-2 py-2 font-medium text-text-muted">Code / Name</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Factory</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Current Broker(s)</th>
                <th className="text-left px-2 py-2 font-medium text-text-muted">Status</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {marks.map((m) => (
                <tr key={m.id} className="border-b border-border last:border-0 align-top">
                  <td className="px-2 py-2 font-mono">{m.code}</td>
                  <td className="px-2 py-2 text-text-muted">
                    {m.factoryCode} — {m.factoryName}
                  </td>
                  <td className="px-2 py-2">
                    {m.currentBrokers.length === 0 ? (
                      <span className="text-text-muted">—</span>
                    ) : (
                      m.currentBrokers.map((b) => (
                        <span key={b} className="inline-block mr-1 mb-1 px-2 py-0.5 rounded-full border border-border text-[11px]">
                          {b}
                        </span>
                      ))
                    )}
                    {m.timeline.length > 1 && (
                      <div className="text-[11px] text-text-muted mt-1" title={m.timeline.map(eraLabel).join(" → ")}>
                        {m.timeline.length} eras
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2">{m.status}</td>
                  <td className="px-2 py-2 text-right whitespace-nowrap">
                    <IconButton size="small" onClick={() => openEditMark(m)} aria-label="Edit">
                      <EditOutlinedIcon fontSize="small" />
                    </IconButton>
                    <IconButton size="small" color="error" onClick={() => deleteMarkRow(m)} aria-label="Delete">
                      <DeleteOutlineIcon fontSize="small" />
                    </IconButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="text-[12.5px] text-text-muted m-0">Search for a mark by code or name, or add one from a factory&apos;s row above.</p>
      )}

      {/* Plantation dialog */}
      <Dialog open={plantationDialogOpen} onClose={() => setPlantationDialogOpen(false)} maxWidth="xs" fullWidth>
        <form onSubmit={savePlantation}>
          <DialogTitle>{editingPlantation ? "Edit Plantation" : "Add Plantation"}</DialogTitle>
          <DialogContent className="flex flex-col gap-3 pt-2">
            {plantationFormError && <div className="p-2 rounded border border-danger bg-danger-light text-[12px] text-danger">{plantationFormError}</div>}
            <input className={inputCls} placeholder="Name" value={plantationName} onChange={(e) => setPlantationName(e.target.value)} required />
            {editingPlantation && (
              <FormControlLabel
                control={<Switch checked={plantationActive} onChange={(e) => setPlantationActive(e.target.checked)} />}
                label="Active"
              />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setPlantationDialogOpen(false)} disabled={plantationBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={plantationBusy || !plantationName.trim()}>
              {plantationBusy ? "Saving…" : "Save"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Factory dialog */}
      <Dialog open={factoryDialogOpen} onClose={() => setFactoryDialogOpen(false)} maxWidth="xs" fullWidth>
        <form onSubmit={saveFactory}>
          <DialogTitle>{editingFactory ? "Edit Factory" : "Add Factory"}</DialogTitle>
          <DialogContent className="flex flex-col gap-3 pt-2">
            {factoryFormError && <div className="p-2 rounded border border-danger bg-danger-light text-[12px] text-danger">{factoryFormError}</div>}
            <Select size="small" displayEmpty value={factoryPlantationId} onChange={(e) => setFactoryPlantationId(e.target.value)}>
              <MenuItem value="">
                <em>No plantation</em>
              </MenuItem>
              {plantations.map((p) => (
                <MenuItem key={p.id} value={p.id}>
                  {p.name}
                </MenuItem>
              ))}
            </Select>
            <input className={inputCls} placeholder="Code (e.g. MF0294)" value={factoryCode} onChange={(e) => setFactoryCode(e.target.value)} required />
            <input className={inputCls} placeholder="Name" value={factoryName} onChange={(e) => setFactoryName(e.target.value)} required />
            {editingFactory && (
              <FormControlLabel control={<Switch checked={factoryActive} onChange={(e) => setFactoryActive(e.target.checked)} />} label="Active" />
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setFactoryDialogOpen(false)} disabled={factoryBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={factoryBusy || !factoryCode.trim() || !factoryName.trim()}>
              {factoryBusy ? "Saving…" : "Save"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>

      {/* Mark dialog */}
      <Dialog open={markDialogOpen} onClose={() => setMarkDialogOpen(false)} maxWidth="xs" fullWidth>
        <form onSubmit={saveMark}>
          <DialogTitle>{editingMark ? "Edit Mark" : "Add Mark"}</DialogTitle>
          <DialogContent className="flex flex-col gap-3 pt-2">
            {markFormError && <div className="p-2 rounded border border-danger bg-danger-light text-[12px] text-danger">{markFormError}</div>}
            <p className="text-[12.5px] text-text-muted m-0">
              Factory: <strong>{markFactoryLabel}</strong>
            </p>
            <input className={inputCls} placeholder="Mark name" value={markName} onChange={(e) => setMarkName(e.target.value)} required />
            <input className={inputCls} placeholder="Mark code (defaults to name)" value={markCode} onChange={(e) => setMarkCode(e.target.value)} />
            {editingMark && (
              <Select size="small" value={markStatus} onChange={(e) => setMarkStatus(e.target.value as "Active" | "Discontinued")}>
                <MenuItem value="Active">Active</MenuItem>
                <MenuItem value="Discontinued">Discontinued</MenuItem>
              </Select>
            )}
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setMarkDialogOpen(false)} disabled={markBusy}>
              Cancel
            </Button>
            <Button type="submit" variant="contained" disabled={markBusy || !markName.trim()}>
              {markBusy ? "Saving…" : "Save"}
            </Button>
          </DialogActions>
        </form>
      </Dialog>
    </AdminSectionCard>
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
    <AdminSectionCard id="audit" icon={<HistoryOutlinedIcon fontSize="small" />} accent={4} title="Audit Log" subtitle="Who did what — role changes, API keys, webhooks, master data, files and knowledge base uploads.">
      {error && <div className="mb-3 p-2.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-[13px] text-danger">{error}</div>}

      {loading ? (
        <div className="flex justify-center py-8">
          <TeaLoader size={40} />
        </div>
      ) : entries.length === 0 ? (
        <p className="text-[13px] text-text-muted m-0">Nothing recorded yet.</p>
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
                    <td className="px-2 py-2 text-text-muted font-mono text-[12px] whitespace-nowrap">{new Date(e.timestamp).toLocaleString()}</td>
                    <td className="px-2 py-2 text-text-muted">{e.userEmail ?? "—"}</td>
                    <td className="px-2 py-2 font-mono text-[12px]">{e.action}</td>
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
    </AdminSectionCard>
  );
}

/** Everything Settings used to gate behind isAdmin, plus the new file manager — pulled into
 *  its own route so it reads as the administrator's command center rather than a few extra
 *  rows tucked under personal account settings. Non-admins never had a way here (no nav tile,
 *  no command palette entry — see nav.ts's `adminOnly`), but a direct URL visit still gets
 *  turned away rather than silently rendering an empty admin page. */
/** One entry per ADMIN_SECTIONS id — the tab strip renders exactly one of these at a time. */
const SECTION_COMPONENTS: Record<string, React.ComponentType> = {
  sales: SalesDataSection,
  msl: MslDataSection,
  newssources: NewsSourcesSection,
  landing: LandingPageSection,
  accessrequests: AccessRequestsSection,
  users: UsersSection,
  apikeys: ApiKeysSection,
  webhooks: WebhooksSection,
  masterdata: MasterDataSection,
  markintelligence: MarkIntelligenceSection,
  audit: AuditLogSection,
};

export default function AdminPage() {
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;
  const [activeSectionId, setActiveSectionId] = useState<string>(ADMIN_SECTIONS[0].id);
  const topOffset = useTopbarHeight();

  // The "Home" pill up here is this app's only way back out of Admin (there's no persistent
  // sidebar app-wide — see PageHeader's own doc comment) — losing it on scroll meant losing
  // the way out. Pinned the same way as AdminSidebar (fixed + measured Topbar height, not
  // sticky — see AdminSidebar's doc comment for why sticky doesn't work in this shell at all),
  // with its own height measured so the content below it can reserve exactly that much space
  // rather than a guessed number that's wrong the moment the title/subtitle wraps differently.
  const headerRef = useRef<HTMLDivElement>(null);
  const [headerHeight, setHeaderHeight] = useState(0);
  useEffect(() => {
    const el = headerRef.current;
    if (!el) return;
    const update = () => setHeaderHeight(el.getBoundingClientRect().height);
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

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
      <AdminSidebar activeId={activeSectionId} onSelect={setActiveSectionId} />

      {/* Matches the sidebar's fixed width (232px) — it's out of flow (position: fixed) at
          md+, so the whole page body (header included, not just the active section) reserves
          its space by hand instead of a flex row doing it automatically. Keeping the header
          and "signed in" banner inside this indent too — not just the section content — is
          what makes the sidebar read as a real left column running the full page height,
          rather than something dropped on top of the title. */}
      <div className="md:ml-[232px]">
        <div
          ref={headerRef}
          className="md:fixed md:right-0 md:left-[232px] md:z-10 md:px-8 md:pt-4 md:border-b md:border-border"
          style={{ top: topOffset, background: "var(--surface-alt)" }}
        >
          <PageHeader title="Admin Panel" subtitle="Full administrative control — users, access, master data and sale/MSL data." />
        </div>
        {/* Reserves the fixed header's real height so content doesn't render underneath it —
            only needed at md+, where the header above is actually taken out of flow. */}
        <div className="hidden md:block" style={{ height: headerHeight }} />

        <div
          className="mb-6 rounded-[var(--radius-lg)] px-4 sm:px-5 py-3.5 flex items-center justify-between gap-3 flex-wrap"
          style={{ background: "var(--tile-gradient-4)" }}
        >
          <div className="flex items-center gap-3 min-w-0">
            <span
              className="flex items-center justify-center w-10 h-10 rounded-full shrink-0"
              style={{ background: "rgba(255,255,255,0.18)" }}
            >
              <AdminPanelSettingsOutlinedIcon sx={{ color: "#fff", fontSize: 22 }} />
            </span>
            <p className="text-[13px] font-semibold text-white m-0 truncate">Signed in as {user?.displayName} · Administrator</p>
          </div>
          <p className="text-[12px] text-white m-0 opacity-80 shrink-0">{ADMIN_SECTIONS.length} control areas</p>
        </div>

        {(() => {
          const ActiveSection = SECTION_COMPONENTS[activeSectionId];
          return <ActiveSection />;
        })()}
      </div>
    </div>
  );
}
