"use client";

import GlassCard from "@/components/ui/GlassCard";
import TiltCard from "@/components/ui/TiltCard";
import { CATEGORY_LABEL } from "@/components/home/MarketPulseTicker";
import { fetchLkrRates, type LkrRates } from "@/lib/currency";
import { timeAgo } from "@/lib/format";
import { fetchColomboWeather, type WeatherNow } from "@/lib/weather";
import { api, ApiError } from "@/lib/api";
import type { MarketPulseItem } from "@/types/api";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import CurrencyExchangeOutlinedIcon from "@mui/icons-material/CurrencyExchangeOutlined";
import NewspaperOutlinedIcon from "@mui/icons-material/NewspaperOutlined";
import ThunderstormOutlinedIcon from "@mui/icons-material/ThunderstormOutlined";
import WbCloudyOutlinedIcon from "@mui/icons-material/WbCloudyOutlined";
import WbSunnyOutlinedIcon from "@mui/icons-material/WbSunnyOutlined";
import Link from "next/link";
import Skeleton from "@mui/material/Skeleton";
import { useEffect, useState } from "react";
import type { SvgIconComponent } from "@mui/icons-material";

const WEATHER_ICON: Record<WeatherNow["icon"], SvgIconComponent> = {
  sun: WbSunnyOutlinedIcon,
  "cloud-sun": WbCloudyOutlinedIcon,
  cloud: CloudOutlinedIcon,
  rain: CloudOutlinedIcon,
  storm: ThunderstormOutlinedIcon,
};

function KpiShell({
  icon: Icon,
  label,
  children,
}: {
  icon: SvgIconComponent;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <TiltCard className="h-full" maxTiltDeg={5}>
      <GlassCard className="h-full p-4 sm:p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <div
            className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
            style={{ background: "var(--liquor-light)" }}
          >
            <Icon sx={{ fontSize: 16, color: "var(--liquor)" }} />
          </div>
          <span className="font-mono text-[10.5px] tracking-[0.15em] uppercase" style={{ color: "var(--text-muted)" }}>
            {label}
          </span>
        </div>
        {children}
      </GlassCard>
    </TiltCard>
  );
}

function RowSkeleton() {
  return (
    <div className="flex flex-col gap-1.5">
      <Skeleton variant="text" width="70%" height={20} />
      <Skeleton variant="text" width="50%" height={16} />
    </div>
  );
}

/**
 * Three glass/tilt KPI cards — Currency, Weather, News — the futuristic-UI treatment for the
 * dashboard called for in Phase 4. Distinct on purpose from the "glance bar" strip further
 * down the page (plain bordered strip, sale-scoped KPIs): this row is decorative/ambient
 * context, not sale data, so it earns the more ornamental glass treatment without competing
 * with the real numbers below it. Fully self-contained (fetches its own data on mount), same
 * pattern as MarketPulseTicker, rather than threading three more fetches through page.tsx.
 * Every source is free/keyless and fails soft to a muted placeholder — never a fabricated
 * number — matching lib/weather.ts's existing convention.
 */
export default function FuturisticKpiRow() {
  const [rates, setRates] = useState<LkrRates | null | undefined>(undefined);
  const [weather, setWeather] = useState<WeatherNow | null | undefined>(undefined);
  const [news, setNews] = useState<MarketPulseItem[] | null | undefined>(undefined);

  useEffect(() => {
    fetchLkrRates().then(setRates);
    fetchColomboWeather().then(setWeather);
    api
      .getMarketPulse({ pageSize: 3, page: 1 })
      .then((r) => setNews(r.items))
      .catch((e) => setNews(e instanceof ApiError ? null : null));
  }, []);

  const WeatherIcon = weather ? WEATHER_ICON[weather.icon] : WbSunnyOutlinedIcon;

  return (
    <div className="grid gap-4 mb-6" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))" }}>
      <KpiShell icon={CurrencyExchangeOutlinedIcon} label="Currency · LKR">
        {rates === undefined ? (
          <RowSkeleton />
        ) : rates === null ? (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-muted)" }}>
            Rates unavailable right now.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {([
              ["USD", rates.usd],
              ["GBP", rates.gbp],
              ["EUR", rates.eur],
            ] as const).map(([code, value]) => (
              <div key={code} className="flex items-baseline justify-between gap-2">
                <span className="text-[12px]" style={{ color: "var(--text-muted)" }}>1 {code}</span>
                <span className="font-mono text-[14px] font-semibold" style={{ color: "var(--text-strong)" }}>
                  {value.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
              </div>
            ))}
          </div>
        )}
      </KpiShell>

      <KpiShell icon={WeatherIcon} label="Colombo Weather">
        {weather === undefined ? (
          <RowSkeleton />
        ) : weather === null ? (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-muted)" }}>
            Weather unavailable right now.
          </p>
        ) : (
          <div>
            <div className="font-mono text-[24px] font-semibold leading-tight" style={{ color: "var(--text-strong)" }}>
              {Math.round(weather.tempC)}°C
            </div>
            <div className="text-[12.5px]" style={{ color: "var(--text-muted)" }}>
              {weather.label}
            </div>
          </div>
        )}
      </KpiShell>

      <KpiShell icon={NewspaperOutlinedIcon} label="Market Pulse">
        {news === undefined ? (
          <RowSkeleton />
        ) : news === null || news.length === 0 ? (
          <p className="text-[12.5px] m-0" style={{ color: "var(--text-muted)" }}>
            No recent stories yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {news.map((item) => (
              <Link key={item.id} href="/market-pulse" className="block no-underline group">
                <p
                  className="text-[12.5px] font-medium leading-snug m-0 line-clamp-2 group-hover:underline"
                  style={{ color: "var(--text-strong)" }}
                >
                  {item.title}
                </p>
                <p className="text-[11px] m-0 mt-0.5" style={{ color: "var(--text-muted)" }}>
                  {item.aiCategory ? CATEGORY_LABEL[item.aiCategory] : "General"}
                  {item.publishedAt ? ` · ${timeAgo(item.publishedAt)}` : ""}
                </p>
              </Link>
            ))}
          </div>
        )}
      </KpiShell>
    </div>
  );
}
