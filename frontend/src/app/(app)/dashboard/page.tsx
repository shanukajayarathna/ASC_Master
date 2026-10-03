"use client";

import AdminDashboard from "./AdminDashboard";
import AiInsightsPanel, { type Insight } from "@/components/home/AiInsightsPanel";
import AttentionList, { type AttentionEntry } from "@/components/home/AttentionList";
import AmbientStrip from "@/components/dashboard/AmbientStrip";
import Footer from "@/components/shell/Footer";
import MarketPulseTicker from "@/components/home/MarketPulseTicker";
import ModuleTile from "@/components/home/ModuleTile";
import RecentActivityList, { type ActivityEntry } from "@/components/home/RecentActivityList";
import TiltCard from "@/components/ui/TiltCard";
import { NAV_ITEMS } from "@/components/shell/nav";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { CatalogueSummary, Conversation, DashboardStats, SavedReport } from "@/types/api";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import ChatBubbleOutlineOutlinedIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import TextField from "@mui/material/TextField";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";

const SUGGESTED_PROMPTS = [
  "Which lots are still unvalued in the active sale?",
  "Summarise this sale's average valuation by grade",
  "What does the knowledge base say about grading standards?",
];

// How many of the most recent sales are considered for week-over-week deltas, AI Insights
// and "Sales Needing Attention" — bounded so the dashboard doesn't fan out into dozens of
// requests on an installation with many sales on file.
const RECENT_SALES_WINDOW = 6;

const PINNED_TILES_KEY = "asc_pinned_tiles";

function greeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

/** Routes to the Admin's operations-control-center dashboard (AdminDashboard) or the
 *  regular launchpad below, based on role — the only thing this file decides; everything
 *  else about either dashboard lives in its own component. */
export default function DashboardPage() {
  const { user } = useAuth();
  if (user?.roles.includes("Admin")) return <AdminDashboard user={user} />;
  return <UserDashboard />;
}

/**
 * The launchpad — the KPI row and module tile grid, with three real panels below them
 * (activity, computed insights, sales needing attention) — see the plan file for what's
 * real vs. deliberately adapted from the reference mockup.
 */
function UserDashboard() {
  const { user } = useAuth();
  // stats comes from CatalogueContext, not a fetch of its own — the topbar's notification
  // badge needs the same DashboardStats, so it's fetched once there and shared (see
  // CatalogueContext's activeStats doc comment).
  const { activeCatalogueId, activeCatalogue, activeStats: stats, error: catalogueError } = useCatalogue();
  const router = useRouter();

  // Lets the recent-sales-window effect below reuse the active sale's stats instead of
  // re-fetching them (it's read via .current, not as a dependency, so this never re-runs
  // that effect — see its comment for why).
  const statsRef = useRef<DashboardStats | null>(null);
  useEffect(() => {
    statsRef.current = stats;
  }, [stats]);

  const [catalogues, setCatalogues] = useState<CatalogueSummary[]>([]);
  const [savedReports, setSavedReports] = useState<SavedReport[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [prompt, setPrompt] = useState("");

  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [attention, setAttention] = useState<AttentionEntry[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  // Which tiles the user has pinned to the top of their own launchpad — purely local
  // (localStorage), never sent anywhere, so this is genuinely "their" personalization
  // rather than something the app is guessing at.
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);
  // The launchpad shows a first "page" of tiles so the activity/insights panels below
  // aren't pushed under the fold by the full grid; one click expands to everything.
  const [showAllTiles, setShowAllTiles] = useState(false);
  // How many columns the responsive grid (2/3/4 by breakpoint) actually resolved to at
  // the current viewport — read from the computed style so the collapsed view can always
  // show exactly two FULL rows rather than cutting off mid-row.
  const tileGridRef = useRef<HTMLDivElement | null>(null);
  const [tileCols, setTileCols] = useState(4);
  useEffect(() => {
    const el = tileGridRef.current;
    if (!el) return;
    const measure = () => {
      const tracks = getComputedStyle(el).gridTemplateColumns.split(" ").filter(Boolean).length;
      setTileCols((prev) => (tracks > 0 && tracks !== prev ? tracks : prev));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const collapsedTileCount = tileCols * 2;
  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PINNED_TILES_KEY) ?? "[]");
      if (Array.isArray(stored)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPinnedHrefs(stored.filter((h): h is string => typeof h === "string"));
      }
    } catch {
      // Corrupt localStorage value — just start with nothing pinned.
    }
  }, []);
  const togglePin = (href: string) => {
    setPinnedHrefs((prev) => {
      const next = prev.includes(href) ? prev.filter((h) => h !== href) : [...prev, href];
      window.localStorage.setItem(PINNED_TILES_KEY, JSON.stringify(next));
      return next;
    });
  };

  // Real, existing data for the recent/pinned surfaces — best-effort, a failed fetch here
  // just leaves that one panel empty rather than breaking the page.
  useEffect(() => {
    api.listCatalogues().then(setCatalogues).catch(() => {});
    api.listSavedReports().then(setSavedReports).catch(() => {});
    api.listConversations().then(setConversations).catch(() => {});
  }, []);

  // Enrichment: AI Insights (real, computed from Analytics breakdown/distribution
  // endpoints) and the "Sales Needing Attention" list — all bounded to the RECENT_SALES_WINDOW most recent sales.
  useEffect(() => {
    if (!activeCatalogueId || catalogues.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInsights([]);
      setAttention([]);
      return;
    }
    let cancelled = false;
    setInsightsLoading(true);
    setAttentionLoading(true);

    const sorted = [...catalogues].sort((a, b) => new Date(b.importedAt).getTime() - new Date(a.importedAt).getTime());
    const activeIdx = sorted.findIndex((c) => c.id === activeCatalogueId);
    const previous = activeIdx >= 0 ? sorted[activeIdx + 1] : undefined;
    const window = sorted.slice(0, RECENT_SALES_WINDOW);
    if (previous && !window.some((c) => c.id === previous.id)) window.push(previous);

    // The active sale is almost always window[0] (it's normally the newest), and its stats
    // were already fetched by the effect above — reuse them instead of firing a second,
    // identical /dashboard request for the same catalogue.
    const getStats = (id: string) =>
      id === activeCatalogueId && statsRef.current
        ? Promise.resolve(statsRef.current)
        : api.getDashboardStats(id);

    (async () => {
      const windowStats = await Promise.all(
        window.map((c) => getStats(c.id).then((s) => ({ c, s })).catch(() => null))
      );
      if (cancelled) return;
      const valid = windowStats.filter((x): x is { c: CatalogueSummary; s: DashboardStats } => x !== null);

      const att: AttentionEntry[] = valid
        .filter((x) => x.s.total > 0)
        .map((x) => ({
          key: x.c.id,
          catalogueId: x.c.id,
          label: x.c.sourceName,
          completionPercent: (x.s.completed / x.s.total) * 100,
          pending: x.s.pending,
        }))
        .filter((e) => e.completionPercent < 100)
        .sort((a, b) => a.completionPercent - b.completionPercent)
        .slice(0, 4);
      if (!cancelled) {
        setAttention(att);
        setAttentionLoading(false);
      }

      const prevEntry = previous ? valid.find((x) => x.c.id === previous.id) : undefined;
      if (!previous || !prevEntry) {
        if (!cancelled) {
          setInsights([]);
          setInsightsLoading(false);
        }
        return;
      }

      const [curBreakdown, prevBreakdown, curDist, prevDist] = await Promise.all([
        api.getBreakdown(activeCatalogueId, "grade").catch(() => []),
        api.getBreakdown(previous.id, "grade").catch(() => []),
        api.getDistribution(activeCatalogueId).catch(() => []),
        api.getDistribution(previous.id).catch(() => []),
      ]);
      if (cancelled) return;

      const computed: Insight[] = [];

      // The grade with the largest average-valuation swing vs the previous sale — ignores
      // grades with under 3 lots in either sale so a single outlier lot can't dominate.
      let biggestSwing: { grade: string; pct: number } | null = null;
      for (const row of curBreakdown) {
        if (row.averageValue == null || row.count < 3) continue;
        const match = prevBreakdown.find((p) => p.label.trim().toLowerCase() === row.label.trim().toLowerCase());
        if (!match || match.averageValue == null || match.count < 3 || match.averageValue === 0) continue;
        const pct = ((row.averageValue - match.averageValue) / match.averageValue) * 100;
        if (!biggestSwing || Math.abs(pct) > Math.abs(biggestSwing.pct)) biggestSwing = { grade: row.label, pct };
      }
      if (biggestSwing && Math.abs(biggestSwing.pct) >= 1) {
        computed.push({
          key: "grade-swing",
          tone: biggestSwing.pct >= 0 ? "up" : "down",
          text: `Avg valuation for ${biggestSwing.grade} grade ${biggestSwing.pct >= 0 ? "increased" : "decreased"} ${Math.abs(biggestSwing.pct).toFixed(1)}% vs ${previous.sourceName}.`,
        });
      }

      // The top classification tier's share of the sale, current vs previous — whichever
      // of Select Best / Best actually appears in both sales' distributions.
      for (const label of ["Select Best", "Best"]) {
        const cur = curDist.find((r) => r.label === label);
        const prev = prevDist.find((r) => r.label === label);
        if (cur?.percent == null || prev?.percent == null) continue;
        const diff = cur.percent - prev.percent;
        if (Math.abs(diff) >= 1) {
          computed.push({
            key: `dist-${label}`,
            tone: diff >= 0 ? "up" : "down",
            text: `${activeCatalogue?.sourceName ?? "This sale"} shows a ${diff >= 0 ? "higher" : "lower"} ${label} share — ${cur.percent.toFixed(1)}% vs ${prev.percent.toFixed(1)}% in ${previous.sourceName}.`,
          });
        }
        break;
      }

      if (!cancelled) {
        setInsights(computed);
        setInsightsLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCatalogueId, catalogues]);

  // Pinned tiles first (in the user's own pin order), everything else after in the
  // original curated order — a personalized "top of my launchpad" without losing the
  // rest of the grid for anyone who hasn't pinned anything. adminOnly tiles never show
  // here — DashboardPage routes any Admin to AdminDashboard before this component mounts.
  const moduleTiles = useMemo(() => {
    const visible = NAV_ITEMS.filter((item) => !item.adminOnly && !item.hiddenFromGrid);
    const rest = visible.filter((item) => item.href !== "/dashboard" && !pinnedHrefs.includes(item.href));
    const pinned = pinnedHrefs
      .map((href) => visible.find((item) => item.href === href))
      .filter((item): item is (typeof NAV_ITEMS)[number] => !!item);
    return [...pinned, ...rest];
  }, [pinnedHrefs]);

  // Hands the typed (or suggested) prompt to the Assistant via ?q= — it lands prefilled
  // in the input for review, never auto-sent. Nothing the user typed is ever discarded.
  const goToAssistant = (q?: string) => {
    const text = (q ?? prompt).trim();
    router.push(text ? `/assistant?q=${encodeURIComponent(text)}` : "/assistant");
  };

  // Sorted by the raw ISO timestamp (kept alongside, since `timeAgo` only produces the
  // display string) then trimmed to the entry shape the list component actually wants.
  const activity: ActivityEntry[] = [
    ...catalogues.map((c) => ({
      sortMs: new Date(c.importedAt).getTime(),
      entry: {
        key: `cat-${c.id}`,
        icon: Inventory2OutlinedIcon,
        iconColor: "var(--liquor)",
        iconBg: "var(--liquor-light)",
        title: `Catalogue imported — ${c.sourceName}`,
        subtitle: `${c.rowCount.toLocaleString()} lots`,
        timestamp: timeAgo(c.importedAt),
        href: "/catalogue",
      } satisfies ActivityEntry,
    })),
    ...savedReports.map((r) => ({
      sortMs: new Date(r.createdAt).getTime(),
      entry: {
        key: `rep-${r.id}`,
        icon: BookmarkAddOutlinedIcon,
        iconColor: "var(--sage-dark)",
        iconBg: "var(--sage-light)",
        title: `Report saved — ${r.title}`,
        subtitle: r.type,
        timestamp: timeAgo(r.createdAt),
        href: "/saved-reports",
      } satisfies ActivityEntry,
    })),
    ...conversations.map((c) => ({
      sortMs: new Date(c.createdAt).getTime(),
      entry: {
        key: `conv-${c.id}`,
        icon: ChatBubbleOutlineOutlinedIcon,
        iconColor: "var(--liquor)",
        iconBg: "var(--brass-dim)",
        title: `AI conversation — ${c.title}`,
        subtitle: "AI Assistant",
        timestamp: timeAgo(c.createdAt),
        href: "/assistant",
      } satisfies ActivityEntry,
    })),
  ]
    .sort((a, b) => b.sortMs - a.sortMs)
    .slice(0, 6)
    .map((x) => x.entry);

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold m-0 mb-1" style={{ color: "var(--text-strong)" }}>
            Intelligence Hub for Smart Asia Siyaka
          </h1>
          <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
            {greeting()}{user ? `, ${user.displayName.split(" ")[0]}` : ""}.{" "}
            {activeCatalogue
              ? `${activeCatalogue.sourceName} is the active sale — ${activeCatalogue.rowCount.toLocaleString()} lots.`
              : "Here's what's happening today."}
          </p>
        </div>
        <AmbientStrip />
      </div>

      <div className="mb-6">
        <MarketPulseTicker variant="dashboard" />
      </div>

      {catalogueError && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-lg)] border border-danger bg-danger-light text-sm text-danger">
          Couldn&apos;t reach the API ({catalogueError}). Is the backend running at{" "}
          <code className="font-mono">{process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:5058"}</code>?
        </div>
      )}

      {!activeCatalogueId && !catalogueError && (
        <div className="text-center py-16" style={{ color: "var(--text-muted)" }}>
          <h3 className="font-display text-xl mb-1" style={{ color: "var(--text)" }}>
            No catalogue loaded yet
          </h3>
          <p className="mb-4">Import a lot catalogue to populate the dashboard.</p>
          <Button component={Link} href="/catalogue" variant="contained" color="primary">
            Go to Catalogue Manager
          </Button>
        </div>
      )}

      {/* ---- launchpad: module tiles replace the old sidebar as the primary navigation ---- */}
      <div className="mt-2 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-[15px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
            What would you like to do today?
          </h2>
          {pinnedHrefs.length > 0 && (
            <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>
              Pinned first
            </span>
          )}
        </div>
        <div ref={tileGridRef} className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3 items-stretch">
          {(showAllTiles ? moduleTiles : moduleTiles.slice(0, collapsedTileCount)).map((item, i) => (
            <TiltCard key={item.href} className="h-full" maxTiltDeg={4}>
              <ModuleTile
                item={item}
                pinned={pinnedHrefs.includes(item.href)}
                onTogglePin={() => togglePin(item.href)}
                priority={i < 4}
              />
            </TiltCard>
          ))}
        </div>
        {moduleTiles.length > collapsedTileCount && (
          <div className="mt-3 text-center">
            <Button size="small" onClick={() => setShowAllTiles((v) => !v)} sx={{ color: "var(--liquor)", textTransform: "none" }}>
              {showAllTiles ? "Show fewer" : `Show all ${moduleTiles.length} modules`}
            </Button>
          </div>
        )}
      </div>

      {/* ---- AI section ---- */}
      <div
        className="mt-6 mb-6 p-5 rounded-[var(--radius-lg)] border border-border"
        style={{ background: "var(--surface)" }}
      >
        <div className="flex items-center gap-2 mb-3">
          <AutoAwesomeOutlinedIcon fontSize="small" sx={{ color: "var(--liquor)" }} />
          <h3 className="font-display text-[15px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
            Ask ASC AI
          </h3>
        </div>
        <form
          className="flex items-center gap-2 mb-3"
          onSubmit={(e) => {
            e.preventDefault();
            goToAssistant();
          }}
        >
          <TextField
            size="small"
            fullWidth
            placeholder="Ask about lots, valuations or documents…"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <IconButton type="submit" aria-label="Ask" sx={{ color: "var(--liquor)" }}>
            <SendOutlinedIcon fontSize="small" />
          </IconButton>
        </form>
        <div className="flex flex-wrap gap-2">
          {SUGGESTED_PROMPTS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => goToAssistant(p)}
              className="px-3 py-1.5 rounded-full border border-border text-[12px] cursor-pointer"
              style={{ color: "var(--text)", background: "var(--surface-alt)" }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ---- three real panels: recent activity, computed AI insights, and sales needing
           attention (this app's honest substitute for the reference mockup's fabricated
           "Upcoming Deadlines" — see the plan for why) ---- */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <RecentActivityList entries={activity} />
        <AiInsightsPanel insights={insights} loading={insightsLoading} />
        <AttentionList entries={attention} loading={attentionLoading} />
      </div>

      {/* Footer lives on the Dashboard only, not site-wide (it was in Shell before) — this
          is the one page people land on and leave from, so it's the natural home for a
          "find anything" nav strip without every other page carrying it too. */}
      <Footer />
    </div>
  );
}
