"use client";

import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { MarketPulseCategory, MarketPulseItem } from "@/types/api";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

export const CATEGORY_LABEL: Record<MarketPulseCategory, string> = {
  TeaMarket: "Tea Market",
  ShippingLogistics: "Shipping & Logistics",
  CurrencyTrade: "Currency & Trade",
  WeatherCrop: "Weather & Crop",
  GlobalEconomy: "Global Economy",
};

const TICKER_SIZE = 9; // 1 hero + up to 8 marquee items
const DEFAULT_POLL_MS = 5 * 60 * 1000;

/**
 * The auction floor price ticker, reused two ways: embedded full-width on the dashboard
 * (variant="dashboard", whole strip taps through to /market-pulse) and pinned as the full
 * page's own masthead (variant="masthead", same look, no outer navigation since you're
 * already there) — "consistency signal between dashboard and full page" per the design
 * brief. Every ticker item deep-links to its own story on the full page
 * (`/market-pulse#item-<id>`), never straight to the external source — that's what "jump
 * straight to that story" means here; the external link itself lives on the story row.
 *
 * Polls GET /market-pulse on its own (default every 5 min), diffs against what's on
 * screen, and only swaps content in when the user isn't actively hovering/reading the
 * strip — a poll landing mid-hover just increments the "N new" badge instead of yanking
 * the ticker out from under the pointer.
 */
export default function MarketPulseTicker({
  variant = "dashboard",
  pollIntervalMs = DEFAULT_POLL_MS,
}: {
  variant?: "dashboard" | "masthead";
  pollIntervalMs?: number;
}) {
  const router = useRouter();
  const [items, setItems] = useState<MarketPulseItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newCount, setNewCount] = useState(0);
  const seenIds = useRef<Set<string> | null>(null);
  const hovering = useRef(false);

  const poll = () => {
    api
      .getMarketPulse({ pageSize: TICKER_SIZE })
      .then((result) => {
        setError(null);
        const incoming = new Set(result.items.map((i) => i.id));
        const isFirstLoad = seenIds.current === null;
        const freshCount = isFirstLoad ? 0 : result.items.filter((i) => !seenIds.current!.has(i.id)).length;

        if (hovering.current && !isFirstLoad) {
          setNewCount((n) => n + freshCount);
          return;
        }
        seenIds.current = incoming;
        setItems(result.items);
        setNewCount(0);
      })
      .catch((e) => setError(e instanceof ApiError ? e.message : "Couldn't load Market Pulse"));
  };

  useEffect(() => {
    poll();
    const id = setInterval(poll, pollIntervalMs);
    return () => clearInterval(id);
  }, [pollIntervalMs]);

  const goToPage = () => router.push("/market-pulse");
  const hero = items?.[0] ?? null;
  const tickerItems = items?.slice(1) ?? [];

  const content = (
    <div className="flex items-stretch" style={{ minHeight: 72, maxHeight: 96 }}>
      {/* Left third: eyebrow + live dot + the single highest-relevance headline as hero */}
      <div
        className="flex items-center px-4 sm:px-6 py-3 shrink-0 w-full md:w-1/3 md:border-r"
        style={{ borderColor: "rgba(244,241,230,0.14)" }}
      >
        <div className="flex flex-col gap-1.5 min-w-0 w-full">
          <div className="flex items-center gap-2">
            <span aria-hidden className="w-1.5 h-1.5 rounded-full mp-live-dot shrink-0" style={{ background: "var(--tea-liquor)" }} />
            <span className="font-mono text-[10px] tracking-[0.16em] uppercase" style={{ color: "var(--tea-liquor)" }}>
              Market Pulse
            </span>
            {newCount > 0 && (
              <span
                className="font-mono text-[9.5px] px-1.5 py-0.5 rounded-full"
                style={{ background: "var(--tea-liquor)", color: "var(--tea-ink)" }}
              >
                {newCount} new
              </span>
            )}
          </div>
          {hero ? (
            <a
              href={`/market-pulse#item-${hero.id}`}
              onClick={(e) => e.stopPropagation()}
              className="no-underline"
            >
              <p
                className="font-display text-[15px] sm:text-[16.5px] font-semibold leading-snug m-0 truncate"
                style={{ color: "var(--tea-ledger)" }}
                title={hero.title}
              >
                {hero.title}
              </p>
            </a>
          ) : error ? (
            <p className="text-[12px] m-0" style={{ color: "var(--tea-ledger)", opacity: 0.75 }}>
              Couldn&apos;t load Market Pulse.
            </p>
          ) : (
            <div className="h-4 w-52 max-w-full rounded" style={{ background: "rgba(244,241,230,0.14)" }} />
          )}
        </div>
      </div>

      {/* Right two-thirds: continuous marquee — hidden below md, where it doesn't work well */}
      <div
        className="hidden md:flex flex-1 items-center overflow-hidden relative"
        onMouseEnter={() => { hovering.current = true; }}
        onMouseLeave={() => { hovering.current = false; }}
      >
        {tickerItems.length > 0 && (
          <div className="flex mp-marquee-track whitespace-nowrap">
            {[...tickerItems, ...tickerItems].map((item, i) => (
              <a
                key={`${item.id}-${i}`}
                href={`/market-pulse#item-${item.id}`}
                onClick={(e) => e.stopPropagation()}
                className="inline-flex items-center gap-2 pr-6 no-underline shrink-0"
              >
                {item.aiCategory && (
                  <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: "var(--tea-liquor)" }}>
                    {CATEGORY_LABEL[item.aiCategory]}
                  </span>
                )}
                <span className="text-[13px] font-medium" style={{ color: "var(--tea-ledger)" }}>
                  {item.title}
                </span>
                <span className="font-mono text-[10px]" style={{ color: "rgba(244,241,230,0.55)" }}>
                  · {timeAgo(item.publishedAt ?? item.ingestedAt)}
                </span>
                <span aria-hidden className="w-px h-3 ml-4" style={{ background: "var(--tea-rule)", opacity: 0.35 }} />
              </a>
            ))}
          </div>
        )}
      </div>

      <a
        href="/market-pulse"
        onClick={(e) => e.stopPropagation()}
        className="hidden md:flex items-center gap-1 px-4 shrink-0 no-underline font-mono text-[11px] tracking-wide transition-opacity hover:opacity-70"
        style={{ color: "var(--tea-liquor)" }}
      >
        View all →
      </a>
    </div>
  );

  if (variant === "masthead") {
    return (
      <div className="w-full overflow-hidden" style={{ background: "var(--tea-ink)" }}>
        {content}
      </div>
    );
  }

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={goToPage}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); goToPage(); } }}
      className="w-full rounded-[var(--radius-md)] overflow-hidden cursor-pointer"
      style={{ background: "var(--tea-ink)", boxShadow: "var(--shadow-md)" }}
    >
      {content}
    </div>
  );
}
