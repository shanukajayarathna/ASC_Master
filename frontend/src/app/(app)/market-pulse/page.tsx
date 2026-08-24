"use client";

import MarketPulseTicker, { CATEGORY_LABEL } from "@/components/home/MarketPulseTicker";
import { useAuth } from "@/context/AuthContext";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { MarketPulseCategory, MarketPulseItem } from "@/types/api";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import NewspaperOutlinedIcon from "@mui/icons-material/NewspaperOutlined";
import OpenInNewOutlinedIcon from "@mui/icons-material/OpenInNewOutlined";
import RefreshOutlinedIcon from "@mui/icons-material/RefreshOutlined";
import Button from "@mui/material/Button";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

const CATEGORIES: MarketPulseCategory[] = ["TeaMarket", "ShippingLogistics", "CurrencyTrade", "WeatherCrop", "GlobalEconomy"];
const PAGE_SIZE = 20;

type Counts = Partial<Record<"all" | MarketPulseCategory, number>>;

function CategoryRail({
  counts, active, onSelect,
}: {
  counts: Counts;
  active: MarketPulseCategory | null;
  onSelect: (c: MarketPulseCategory | null) => void;
}) {
  const row = (label: string, isActive: boolean, count: number | undefined, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      className="flex items-center justify-between gap-3 px-3 py-2 rounded-[var(--radius-sm)] text-left shrink-0 md:shrink md:w-full transition-colors"
      style={{
        background: isActive ? "var(--tea-leaf)" : "transparent",
        color: isActive ? "var(--tea-ledger)" : "var(--text)",
      }}
    >
      <span className="text-[13px] font-medium whitespace-nowrap">{label}</span>
      <span className="font-mono text-[11.5px] shrink-0" style={{ color: isActive ? "var(--tea-ledger)" : "var(--text-muted)", opacity: isActive ? 0.85 : 1 }}>
        {count ?? "—"}
      </span>
    </button>
  );

  return (
    <nav
      aria-label="Filter by category"
      className="flex md:flex-col gap-1 overflow-x-auto md:overflow-visible pb-1 md:pb-0 md:sticky md:top-24"
    >
      {row("All Stories", active === null, counts.all, () => onSelect(null), "all")}
      {CATEGORIES.map((c) => row(CATEGORY_LABEL[c], active === c, counts[c], () => onSelect(c), c))}
    </nav>
  );
}

function StoryRow({ item }: { item: MarketPulseItem }) {
  const highRelevance = (item.aiRelevanceScore ?? 0) >= 80;
  return (
    <article
      id={`item-${item.id}`}
      className="py-4 pl-3.5"
      style={{ borderBottom: "1px solid var(--tea-rule)", borderLeft: `3px solid ${highRelevance ? "var(--auction-alert)" : "transparent"}` }}
    >
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        {item.aiCategory ? (
          <span
            className="font-mono text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full"
            style={{ background: "var(--tea-leaf)", color: "var(--tea-ledger)" }}
          >
            {CATEGORY_LABEL[item.aiCategory]}
          </span>
        ) : (
          <span
            className="font-mono text-[10px] tracking-wide uppercase px-2 py-0.5 rounded-full border"
            style={{ borderColor: "var(--tea-rule)", color: "var(--text-muted)" }}
          >
            Not yet scored
          </span>
        )}
        <span className="font-mono text-[11px]" style={{ color: "var(--text-muted)" }}>
          {item.sourceName} · {timeAgo(item.publishedAt ?? item.ingestedAt)}
        </span>
        {highRelevance && (
          <span className="font-mono text-[10px] uppercase tracking-wide font-semibold" style={{ color: "var(--auction-alert)" }}>
            High relevance
          </span>
        )}
      </div>
      <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer" className="no-underline inline-flex items-start gap-1.5 group">
        <h2 className="font-display text-[16.5px] sm:text-[17.5px] font-semibold m-0 leading-snug transition-colors group-hover:opacity-80" style={{ color: "var(--text-strong)" }}>
          {item.title}
        </h2>
        <OpenInNewOutlinedIcon sx={{ fontSize: 14, color: "var(--text-muted)", marginTop: "5px", flexShrink: 0 }} />
      </a>
      {item.aiWhyItMatters && (
        <p className="text-[13.5px] mt-1.5 mb-0 max-w-[65ch]" style={{ color: "var(--text)" }}>
          {item.aiWhyItMatters}
        </p>
      )}
    </article>
  );
}

export default function MarketPulsePage() {
  const { user } = useAuth();
  const isAdmin = user?.roles.includes("Admin") ?? false;

  const [category, setCategory] = useState<MarketPulseCategory | null>(null);
  const [items, setItems] = useState<MarketPulseItem[] | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [counts, setCounts] = useState<Counts>({});
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshMessage, setRefreshMessage] = useState<string | null>(null);
  const scrolledToHash = useRef(false);

  const load = (targetCategory: MarketPulseCategory | null, targetPage: number, append: boolean) => {
    if (append) setLoadingMore(true);
    api
      .getMarketPulse({ category: targetCategory ?? undefined, page: targetPage, pageSize: PAGE_SIZE })
      .then((result) => {
        setError(null);
        setItems((prev) => (append && prev ? [...prev, ...result.items] : result.items));
        setTotal(result.total);
        setPage(targetPage);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load Market Pulse"))
      .finally(() => setLoadingMore(false));
  };

  const loadCounts = () => {
    Promise.all([
      api.getMarketPulse({ pageSize: 1 }),
      ...CATEGORIES.map((c) => api.getMarketPulse({ category: c, pageSize: 1 })),
    ])
      .then(([all, ...byCategory]) => {
        const next: Counts = { all: all.total };
        CATEGORIES.forEach((c, i) => { next[c] = byCategory[i].total; });
        setCounts(next);
      })
      .catch(() => {
        // Counts are a nice-to-have next to each label — a failure here shouldn't block the
        // story list itself, which has its own independent error handling.
      });
  };

  useEffect(() => {
    (async () => {
      await Promise.resolve();
      load(null, 1, false);
      loadCounts();
    })();
  }, []);

  // Land on a specific story via a ticker deep link (#item-<id>) — every ticker item is
  // guaranteed to be within this page's default (All, page 1) result set, since the ticker
  // only ever shows the same top-by-relevance-then-recency items this page defaults to.
  useEffect(() => {
    if (scrolledToHash.current || !items || items.length === 0) return;
    const hash = window.location.hash;
    if (!hash) return;
    const el = document.getElementById(hash.slice(1));
    if (el) {
      scrolledToHash.current = true;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
      el.classList.add("mp-highlight");
      setTimeout(() => el.classList.remove("mp-highlight"), 2500);
    }
  }, [items]);

  const selectCategory = (next: MarketPulseCategory | null) => {
    setCategory(next);
    load(next, 1, false);
  };

  const refresh = async () => {
    setRefreshing(true);
    setRefreshMessage(null);
    try {
      const summary = await api.refreshMarketPulse();
      setRefreshMessage(
        `${summary.newItems} new item(s), ${summary.scored} scored${summary.sourcesFailed > 0 ? `, ${summary.sourcesFailed} source(s) failed` : ""}.`
      );
      load(category, 1, false);
      loadCounts();
    } catch (e) {
      setRefreshMessage(e instanceof ApiError ? e.message : "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const categoryLabel = category ? CATEGORY_LABEL[category] : "All Stories";

  return (
    <div>
      <Link
        href="/dashboard"
        className="inline-flex items-center gap-1 px-2.5 py-1.5 mb-3 rounded-full border border-border text-[12.5px] font-semibold no-underline transition-colors hover:border-[var(--tea-liquor)] hover:text-[var(--tea-liquor)]"
        style={{ color: "var(--text)", background: "var(--surface)" }}
      >
        <ArrowBackIcon sx={{ fontSize: 15 }} />
        Home
      </Link>

      <div className="mb-6 rounded-[var(--radius-md)] overflow-hidden" style={{ boxShadow: "var(--shadow-md)" }}>
        <MarketPulseTicker variant="masthead" />
      </div>

      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div>
          <h1 className="font-display text-2xl font-bold m-0 mb-1" style={{ color: "var(--text-strong)" }}>
            {categoryLabel}
          </h1>
          <p className="text-[13px] m-0" style={{ color: "var(--text-muted)" }}>
            AI-scored tea, shipping and trade news — every story links back to its real source.
          </p>
        </div>
        {isAdmin && (
          <Button
            size="small"
            variant="outlined"
            startIcon={<RefreshOutlinedIcon fontSize="small" />}
            onClick={refresh}
            disabled={refreshing}
            sx={{ borderColor: "var(--tea-liquor)", color: "var(--tea-liquor)" }}
          >
            {refreshing ? "Refreshing…" : "Refresh Now"}
          </Button>
        )}
      </div>

      {refreshMessage && (
        <div className="mb-4 p-2.5 rounded border text-[12.5px]" style={{ background: "var(--surface-sunken)", borderColor: "var(--border)", color: "var(--text)" }}>
          {refreshMessage}
        </div>
      )}

      <div className="flex flex-col md:flex-row gap-6 items-start">
        <div className="w-full md:w-[200px] shrink-0">
          <CategoryRail counts={counts} active={category} onSelect={selectCategory} />
        </div>

        <div className="flex-1 min-w-0 w-full">
          {error && (
            <div className="mb-4 p-3 rounded border border-danger bg-danger-light text-[12.5px] text-liquor-dark">{error}</div>
          )}

          {items === null ? (
            <div className="flex flex-col gap-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="py-4" style={{ borderBottom: "1px solid var(--tea-rule)" }}>
                  <div className="h-3 w-28 rounded mb-2" style={{ background: "var(--surface-sunken)" }} />
                  <div className="h-5 w-3/4 rounded mb-2" style={{ background: "var(--surface-sunken)" }} />
                  <div className="h-3.5 w-1/2 rounded" style={{ background: "var(--surface-sunken)" }} />
                </div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-16 text-center">
              <NewspaperOutlinedIcon sx={{ fontSize: 30, color: "var(--text-muted)" }} />
              <p className="text-[13.5px] font-medium m-0" style={{ color: "var(--text-strong)" }}>
                No stories yet in this category.
              </p>
              <p className="text-[12.5px] m-0" style={{ color: "var(--text-muted)" }}>
                Check back after the next ingestion run, or try a different category.
              </p>
            </div>
          ) : (
            <>
              <div>
                {items.map((item) => (
                  <StoryRow key={item.id} item={item} />
                ))}
              </div>

              {items.length < total && (
                <div className="flex justify-center mt-6">
                  <Button
                    variant="outlined"
                    onClick={() => load(category, page + 1, true)}
                    disabled={loadingMore}
                    sx={{ borderColor: "var(--tea-liquor)", color: "var(--tea-liquor)" }}
                  >
                    {loadingMore ? "Loading…" : `Load More (${total - items.length} remaining)`}
                  </Button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
