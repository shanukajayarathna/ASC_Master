"use client";

import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { MarketPulseCategory, PublicMarketPulseItem } from "@/types/api";
import { useEffect, useState } from "react";

const CATEGORY_LABEL: Record<MarketPulseCategory, string> = {
  TeaMarket: "Tea Market",
  ShippingLogistics: "Shipping & Logistics",
  CurrencyTrade: "Currency & Trade",
  WeatherCrop: "Weather & Crop",
  GlobalEconomy: "Global Economy",
};

const POLL_MS = 5 * 60 * 1000;

/**
 * The public auction-floor ticker strip beneath the hero — real Market Pulse headlines via
 * the public, trimmed `GET /market-pulse/public-ticker` endpoint (see MarketPulseController),
 * same marquee pattern/CSS (`.mp-marquee-track`, `.mp-live-dot`) the internal Market Pulse
 * widget already uses. Never fabricated data: if nothing is live, this is simply whatever the
 * newest N items are, exactly as the internal ticker behaves.
 *
 * Items are plain text, not links — /market-pulse itself sits behind the authenticated app
 * shell, so sending a signed-out visitor there would just bounce them to /login mid-read.
 */
export default function PublicTicker() {
  const [items, setItems] = useState<PublicMarketPulseItem[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    const poll = () => {
      api
        .getPublicMarketPulseTicker()
        .then((res) => {
          setError(false);
          setItems(res);
        })
        .catch(() => setError(true));
    };
    poll();
    const id = setInterval(poll, POLL_MS);
    return () => clearInterval(id);
  }, []);

  if (error || (items && items.length === 0)) return null;

  return (
    <div className="w-full overflow-hidden" style={{ background: "var(--tea-ink)" }}>
      <div className="max-w-7xl mx-auto flex items-center" style={{ minHeight: 56 }}>
        <div className="flex items-center gap-2 px-4 sm:px-6 py-3 shrink-0 border-r" style={{ borderColor: "rgba(244,241,230,0.14)" }}>
          <span aria-hidden className="w-1.5 h-1.5 rounded-full mp-live-dot shrink-0" style={{ background: "var(--tea-liquor)" }} />
          <span className="font-mono text-[10px] tracking-[0.16em] uppercase whitespace-nowrap" style={{ color: "var(--tea-liquor)" }}>
            Market Pulse
          </span>
        </div>

        <div className="flex-1 overflow-hidden">
          {items === null ? (
            <div className="px-6 py-3 h-4 w-52 rounded" style={{ background: "rgba(244,241,230,0.14)" }} />
          ) : (
            <div className="flex mp-marquee-track whitespace-nowrap">
              {[...items, ...items].map((item, i) => (
                <span key={`${item.title}-${i}`} className="inline-flex items-center gap-2 pr-6 shrink-0 pl-6">
                  {item.aiCategory && (
                    <span className="font-mono text-[10px] tracking-wider uppercase" style={{ color: "var(--tea-liquor)" }}>
                      {CATEGORY_LABEL[item.aiCategory]}
                    </span>
                  )}
                  <span className="text-[13px] font-medium" style={{ color: "var(--tea-ledger)" }}>
                    {item.title}
                  </span>
                  {item.publishedAt && (
                    <span className="font-mono text-[10px]" style={{ color: "rgba(244,241,230,0.55)" }}>
                      · {timeAgo(item.publishedAt)}
                    </span>
                  )}
                  <span aria-hidden className="w-px h-3 ml-4" style={{ background: "var(--tea-rule)", opacity: 0.35 }} />
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
