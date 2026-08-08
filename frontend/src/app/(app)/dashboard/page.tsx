"use client";

import AiInsightsPanel, { type Insight } from "@/components/home/AiInsightsPanel";
import AttentionList, { type AttentionEntry } from "@/components/home/AttentionList";
import AutoSlidingKpiPanel, { type KpiSlide } from "@/components/home/AutoSlidingKpiPanel";
import ModuleTile from "@/components/home/ModuleTile";
import RecentActivityList, { type ActivityEntry } from "@/components/home/RecentActivityList";
import Sparkline from "@/components/home/Sparkline";
import { NAV_ITEMS } from "@/components/shell/nav";
import { useAuth } from "@/context/AuthContext";
import { useCatalogue } from "@/context/CatalogueContext";
import { api } from "@/lib/api";
import { formatCurrency, formatNumber, timeAgo } from "@/lib/format";
import { fetchColomboWeather, type WeatherNow } from "@/lib/weather";
import type { CatalogueSummary, Conversation, DashboardStats, SavedReport } from "@/types/api";
import AdminPanelSettingsOutlinedIcon from "@mui/icons-material/AdminPanelSettingsOutlined";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import BookmarkAddOutlinedIcon from "@mui/icons-material/BookmarkAddOutlined";
import CalendarTodayOutlinedIcon from "@mui/icons-material/CalendarTodayOutlined";
import CenterFocusStrongOutlinedIcon from "@mui/icons-material/CenterFocusStrongOutlined";
import CheckCircleOutlinedIcon from "@mui/icons-material/CheckCircleOutlined";
import ChatBubbleOutlineOutlinedIcon from "@mui/icons-material/ChatBubbleOutlineOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import EventAvailableOutlinedIcon from "@mui/icons-material/EventAvailableOutlined";
import HourglassEmptyOutlinedIcon from "@mui/icons-material/HourglassEmptyOutlined";
import Inventory2OutlinedIcon from "@mui/icons-material/Inventory2Outlined";
import LayersOutlinedIcon from "@mui/icons-material/LayersOutlined";
import SendOutlinedIcon from "@mui/icons-material/SendOutlined";
import ThunderstormOutlinedIcon from "@mui/icons-material/ThunderstormOutlined";
import TrendingUpOutlinedIcon from "@mui/icons-material/TrendingUpOutlined";
import WbCloudyOutlinedIcon from "@mui/icons-material/WbCloudyOutlined";
import WbSunnyOutlinedIcon from "@mui/icons-material/WbSunnyOutlined";
import Button from "@mui/material/Button";
import IconButton from "@mui/material/IconButton";
import Skeleton from "@mui/material/Skeleton";
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

const WEATHER_ICON: Record<WeatherNow["icon"], typeof WbSunnyOutlinedIcon> = {
  sun: WbSunnyOutlinedIcon,
  "cloud-sun": WbCloudyOutlinedIcon,
  cloud: CloudOutlinedIcon,
  rain: WbCloudyOutlinedIcon,
  storm: ThunderstormOutlinedIcon,
};

/**
 * The launchpad — every existing "Executive Dashboard" KPI section is kept exactly as it
 * was (same DashboardStats fields, same endpoint, no data removed). Above it sits a
 * compact glance bar, and below the module tile grid sit three real panels (activity,
 * computed insights, sales needing attention) — see the plan file for what's real vs.
 * deliberately adapted from the reference mockup.
 */
export default function DashboardPage() {
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
  const [weather, setWeather] = useState<WeatherNow | null>(null);

  const [previousStats, setPreviousStats] = useState<DashboardStats | null>(null);
  const [previousSaleName, setPreviousSaleName] = useState<string | null>(null);
  const [insights, setInsights] = useState<Insight[]>([]);
  const [insightsLoading, setInsightsLoading] = useState(false);
  const [attention, setAttention] = useState<AttentionEntry[]>([]);
  const [attentionLoading, setAttentionLoading] = useState(false);
  // Chronological (oldest first) avg-valuation per sale across the recent window — feeds
  // the glance bar's sparkline. Real numbers only: sales with no valued lots (null avg)
  // are dropped rather than plotted as zero.
  const [avgValuationTrend, setAvgValuationTrend] = useState<number[]>([]);

  // Which tiles the user has pinned to the top of their own launchpad — purely local
  // (localStorage), never sent anywhere, so this is genuinely "their" personalization
  // rather than something the app is guessing at.
  const [pinnedHrefs, setPinnedHrefs] = useState<string[]>([]);
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
  // just leaves that one panel empty rather than breaking the page. Weather is likewise
  // best-effort: fetchColomboWeather resolves null on any failure.
  useEffect(() => {
    api.listCatalogues().then(setCatalogues).catch(() => {});
    api.listSavedReports().then(setSavedReports).catch(() => {});
    api.listConversations().then(setConversations).catch(() => {});
    fetchColomboWeather().then(setWeather);
  }, []);

  // Enrichment: the previous sale's stats (for the Avg Valuation delta), AI Insights
  // (real, computed from Analytics breakdown/distribution endpoints), and the "Sales
  // Needing Attention" list — all bounded to the RECENT_SALES_WINDOW most recent sales.
  useEffect(() => {
    if (!activeCatalogueId || catalogues.length === 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreviousStats(null);
      setInsights([]);
      setAttention([]);
      setAvgValuationTrend([]);
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

      // Oldest-first avg-valuation trend for the glance bar's sparkline — sales with no
      // valued lots yet are skipped rather than plotted as a misleading zero.
      const trend = valid
        .filter((x) => x.s.avgValuation != null)
        .sort((a, b) => new Date(a.c.importedAt).getTime() - new Date(b.c.importedAt).getTime())
        .map((x) => x.s.avgValuation as number);
      if (!cancelled) setAvgValuationTrend(trend);

      const prevEntry = previous ? valid.find((x) => x.c.id === previous.id) : undefined;
      if (!cancelled) {
        setPreviousStats(prevEntry?.s ?? null);
        setPreviousSaleName(previous?.sourceName ?? null);
      }

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
  // rest of the grid for anyone who hasn't pinned anything.
  const moduleTiles = useMemo(() => {
    const rest = NAV_ITEMS.filter((item) => item.href !== "/dashboard" && !pinnedHrefs.includes(item.href));
    const pinned = pinnedHrefs
      .map((href) => NAV_ITEMS.find((item) => item.href === href))
      .filter((item): item is (typeof NAV_ITEMS)[number] => !!item);
    return [...pinned, ...rest];
  }, [pinnedHrefs]);

  // The Assistant page has no prefill support today, so this can't hand a typed/suggested
  // prompt over — it gets the taster there in one click rather than silently swallowing
  // whatever they typed.
  const goToAssistant = () => router.push("/assistant");

  const totalLotsAllSales = catalogues.reduce((sum, c) => sum + c.rowCount, 0);
  const avgValuationDeltaPct =
    stats?.avgValuation != null && previousStats?.avgValuation
      ? ((stats.avgValuation - previousStats.avgValuation) / previousStats.avgValuation) * 100
      : null;

  // The detailed breakdown that used to be three stacked KpiSections — same data, now fed
  // to AutoSlidingKpiPanel as slides so it takes one compact card instead of a long scroll.
  const kpiSlides: KpiSlide[] = stats
    ? [
        {
          title: "Valuation Range",
          subtitle: "Across all valued lots",
          tiles: [
            { label: "Highest Valuation", value: formatCurrency(stats.maxValuation) },
            { label: "Lowest Valuation", value: formatCurrency(stats.minValuation) },
            { label: "Average Range Width", value: formatCurrency(stats.avgRangeWidth) },
          ],
        },
        {
          title: "Portfolio Composition",
          tiles: [
            { label: "Most Active Broker", value: stats.mostActiveBroker ?? "—" },
            { label: "Most Common Grade", value: stats.mostCommonGrade ?? "—" },
            { label: "Most Common Category", value: stats.mostCommonCategory ?? "—" },
            { label: "Most Common Elevation", value: stats.mostCommonElevation ?? "—" },
          ],
        },
        {
          title: "Weight & Volume",
          tiles: [
            { label: "Total Net Weight", value: stats.totalNetWeight ? `${formatNumber(stats.totalNetWeight)} kg` : "—" },
            { label: "Total Gross Weight", value: stats.totalGrossWeight ? `${formatNumber(stats.totalGrossWeight)} kg` : "—" },
            { label: "Average Net Weight", value: stats.avgNetWeight ? `${formatNumber(stats.avgNetWeight, 1)} kg` : "—" },
            { label: "Average Gross Weight", value: stats.avgGrossWeight ? `${formatNumber(stats.avgGrossWeight, 1)} kg` : "—" },
          ],
        },
      ]
    : [];

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

  const WeatherIcon = weather ? WEATHER_ICON[weather.icon] : null;

  return (
    <div>
      <div className="mb-5 flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-display text-[26px] font-bold m-0 mb-1" style={{ color: "var(--text-strong)" }}>
            {greeting()}{user ? `, ${user.displayName.split(" ")[0]}` : ""}! 👋
          </h1>
          <p className="text-[13.5px] m-0" style={{ color: "var(--text-muted)" }}>
            {activeCatalogue
              ? `${activeCatalogue.sourceName} is the active sale — ${activeCatalogue.rowCount.toLocaleString()} lots.`
              : "Here's what's happening with your tea auctions today."}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div
            className="flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-md)] border border-border"
            style={{ background: "var(--surface)" }}
          >
            <CalendarTodayOutlinedIcon sx={{ fontSize: 18, color: "var(--sage-dark)" }} />
            <div className="leading-tight">
              <div className="text-[12px] font-semibold" style={{ color: "var(--text-strong)" }}>
                {new Date().toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}
              </div>
              <div className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                Colombo, Sri Lanka
              </div>
            </div>
          </div>
          {weather && WeatherIcon && (
            <div
              className="flex items-center gap-2 px-3.5 py-2 rounded-[var(--radius-md)] border border-border"
              style={{ background: "var(--surface)" }}
            >
              <WeatherIcon sx={{ fontSize: 18, color: "var(--info)" }} />
              <div className="leading-tight">
                <div className="text-[12px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {Math.round(weather.tempC)}°C
                </div>
                <div className="text-[10.5px]" style={{ color: "var(--text-muted)" }}>
                  {weather.label}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {catalogueError && (
        <div className="mb-4 p-3.5 rounded-[var(--radius-md)] border border-danger bg-danger-light text-sm text-liquor-dark">
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

      {/* ---- glance bar skeleton: same six-column strip, shown until `stats` resolves so
           the page never sits blank while the sale's file loads/parses server-side (that
           can take several seconds on a cold cache) — see DashboardController. ---- */}
      {activeCatalogueId && !stats && (
        <div
          className="mb-6 rounded-[var(--radius-lg)] border border-border grid"
          style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <div
              key={i}
              className="flex items-start gap-2.5 p-4"
              style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}
            >
              <Skeleton variant="circular" width={36} height={36} sx={{ flexShrink: 0 }} />
              <div className="min-w-0 flex-1">
                <Skeleton variant="text" width="65%" height={14} />
                <Skeleton variant="text" width="45%" height={24} />
                <Skeleton variant="text" width="55%" height={13} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- glance bar: one bordered strip, six real KPIs — right after the greeting,
           the first real content on the page ---- */}
      {activeCatalogueId && stats && (
        <div
          className="mb-6 rounded-[var(--radius-lg)] border border-border grid"
          style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))" }}
        >
          {[
            {
              icon: LayersOutlinedIcon,
              color: "var(--sage-dark)",
              bg: "var(--sage-light)",
              label: "Total Lots (All Sales)",
              value: totalLotsAllSales.toLocaleString(),
              sub: `across ${catalogues.length} sale${catalogues.length === 1 ? "" : "s"}`,
              trend: undefined as number[] | undefined,
            },
            {
              icon: CheckCircleOutlinedIcon,
              color: "var(--info)",
              bg: "var(--info-light)",
              label: "Valuations Completed",
              value: stats.completed.toLocaleString(),
              sub: `${stats.total > 0 ? Math.round((stats.completed / stats.total) * 100) : 0}% completion rate`,
              trend: undefined as number[] | undefined,
            },
            {
              icon: HourglassEmptyOutlinedIcon,
              color: "var(--warn)",
              bg: "var(--warn-light)",
              label: "Pending Valuations",
              value: stats.pending.toLocaleString(),
              sub: "this sale",
              trend: undefined as number[] | undefined,
            },
            {
              icon: TrendingUpOutlinedIcon,
              color: "var(--liquor)",
              bg: "var(--liquor-light)",
              label: "Avg Valuation",
              value: formatCurrency(stats.avgValuation, 0),
              sub:
                avgValuationDeltaPct != null
                  ? `${avgValuationDeltaPct >= 0 ? "↑" : "↓"} ${Math.abs(avgValuationDeltaPct).toFixed(1)}% vs ${previousSaleName ?? "last sale"}`
                  : "no previous sale to compare",
              trend: avgValuationTrend,
            },
            {
              icon: EventAvailableOutlinedIcon,
              color: "var(--sage-dark)",
              bg: "var(--sage-light)",
              label: "Today's Valuations",
              value: stats.todayCount.toLocaleString(),
              sub: "saved today",
              trend: undefined as number[] | undefined,
            },
            {
              icon: Inventory2OutlinedIcon,
              color: "var(--info)",
              bg: "var(--info-light)",
              label: "Active Sales",
              value: catalogues.length.toLocaleString(),
              sub: "on file",
              trend: undefined as number[] | undefined,
            },
          ].map((k, i) => (
            <div
              key={k.label}
              className="flex items-start gap-2.5 p-4"
              style={{ borderLeft: i === 0 ? undefined : "1px solid var(--border)" }}
            >
              <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0" style={{ background: k.bg }}>
                <k.icon sx={{ fontSize: 18, color: k.color }} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[11px]" style={{ color: "var(--text-muted)" }}>
                  {k.label}
                </div>
                <div className="flex items-center gap-2">
                  <div className="font-mono text-[19px] font-semibold leading-tight" style={{ color: "var(--text-strong)" }}>
                    {k.value}
                  </div>
                  {k.trend && k.trend.length >= 2 && (
                    <Sparkline values={k.trend} color={k.color} width={48} height={18} />
                  )}
                </div>
                <div className="text-[10.5px] truncate" style={{ color: "var(--text-muted)" }}>
                  {k.sub}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ---- primary action: jump straight into Focus mode at the next lot needing
           attention, instead of making every visit navigate there manually first ---- */}
      {activeCatalogueId && stats && stats.pending > 0 && (
        <Link
          href="/valuation?focus=1"
          className="mb-3 flex items-center gap-3 p-4 rounded-[var(--radius-lg)] no-underline lift-on-hover"
          style={{ background: "var(--rule-brand)" }}
        >
          <span
            className="w-11 h-11 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "rgba(255,255,255,0.22)" }}
          >
            <CenterFocusStrongOutlinedIcon sx={{ fontSize: 22, color: "#fff" }} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="font-display text-[16px] font-bold" style={{ color: "#fff" }}>
              Continue Valuing
            </div>
            <div className="text-[12.5px]" style={{ color: "rgba(255,255,255,0.88)" }}>
              {stats.pending.toLocaleString()} lot{stats.pending === 1 ? "" : "s"} still need a valuation
              {activeCatalogue ? ` in ${activeCatalogue.sourceName}` : ""}
            </div>
          </div>
          <ArrowForwardIcon sx={{ fontSize: 20, color: "#fff" }} />
        </Link>
      )}

      {/* ---- Admin-only shortcut — the real role distinction this account system actually
           has is Admin vs. User, so this is the one place the dashboard differentiates by
           role rather than inventing job-title personas the backend doesn't model. ---- */}
      {user?.roles.includes("Admin") && (
        <Link
          href="/settings"
          className="mb-6 flex items-center gap-3 p-3.5 rounded-[var(--radius-lg)] border border-border no-underline lift-on-hover"
          style={{ background: "var(--surface)" }}
        >
          <span
            className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--brass-dim)" }}
          >
            <AdminPanelSettingsOutlinedIcon sx={{ fontSize: 18, color: "var(--liquor)" }} />
          </span>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-semibold" style={{ color: "var(--text-strong)" }}>
              Admin
            </div>
            <div className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              Manage users, API keys and webhooks
            </div>
          </div>
          <ArrowForwardIcon sx={{ fontSize: 16, color: "var(--text-muted)" }} />
        </Link>
      )}

      {/* ---- the same Valuation Range / Portfolio Composition / Weight & Volume detail as
           before, now one auto-rotating card instead of three stacked sections ---- */}
      {activeCatalogueId && stats && <AutoSlidingKpiPanel slides={kpiSlides} />}
      {activeCatalogueId && !stats && (
        <Skeleton variant="rounded" height={140} className="mb-6" sx={{ borderRadius: "var(--radius-lg)" }} />
      )}

      {/* ---- launchpad: module tiles replace the old sidebar as the primary navigation ---- */}
      <div className="mt-2 mb-4">
        <div className="flex items-center gap-2 mb-3">
          <h2 className="font-display text-[19px] font-semibold m-0" style={{ color: "var(--text-strong)" }}>
            What would you like to do today?
          </h2>
          {pinnedHrefs.length > 0 && (
            <span className="text-[11.5px]" style={{ color: "var(--text-muted)" }}>
              — pinned tiles first
            </span>
          )}
        </div>
        <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))" }}>
          {moduleTiles.map((item, i) => (
            <ModuleTile
              key={item.href}
              item={item}
              pinned={pinnedHrefs.includes(item.href)}
              onTogglePin={() => togglePin(item.href)}
              priority={i < 4}
            />
          ))}
        </div>
      </div>

      {/* ---- AI section ---- */}
      <div
        className="mt-6 mb-6 p-5 rounded-[var(--radius-xl)] border border-border"
        style={{ background: "var(--surface)", boxShadow: "var(--shadow-sm)" }}
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
              onClick={goToAssistant}
              className="px-3 py-1.5 rounded-full border border-border text-[12px] cursor-pointer"
              style={{ color: "var(--text)", background: "var(--surface-alt)" }}
            >
              {p}
            </button>
          ))}
        </div>
      </div>

      {/* ---- three real panels: recent activity, computed AI insights, sales needing
           attention (this app's honest substitute for the reference mockup's fabricated
           "Upcoming Deadlines" — see the plan for why) ---- */}
      <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        <RecentActivityList entries={activity} />
        <AiInsightsPanel insights={insights} loading={insightsLoading} />
        <AttentionList entries={attention} loading={attentionLoading} />
      </div>

      <div className="text-center pt-4 border-t border-border">
        <p className="text-[12px] m-0" style={{ color: "var(--text-muted)" }}>
          ASC — Tea Auction Valuation &amp; Business Intelligence Platform
        </p>
        <p className="text-[11px] m-0" style={{ color: "var(--text-muted)" }}>
          © {new Date().getFullYear()} Asia Siyaka Commodities (Pvt) Ltd. All rights reserved.
        </p>
      </div>
    </div>
  );
}
