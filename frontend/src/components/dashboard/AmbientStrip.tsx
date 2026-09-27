"use client";

import { fetchLkrRates, type LkrRates } from "@/lib/currency";
import { fetchColomboWeather, type WeatherNow } from "@/lib/weather";
import CalendarTodayOutlinedIcon from "@mui/icons-material/CalendarTodayOutlined";
import CloudOutlinedIcon from "@mui/icons-material/CloudOutlined";
import ThunderstormOutlinedIcon from "@mui/icons-material/ThunderstormOutlined";
import WbCloudyOutlinedIcon from "@mui/icons-material/WbCloudyOutlined";
import WbSunnyOutlinedIcon from "@mui/icons-material/WbSunnyOutlined";
import type { SvgIconComponent } from "@mui/icons-material";
import { useEffect, useState } from "react";

const WEATHER_ICON: Record<WeatherNow["icon"], SvgIconComponent> = {
  sun: WbSunnyOutlinedIcon,
  "cloud-sun": WbCloudyOutlinedIcon,
  cloud: CloudOutlinedIcon,
  rain: CloudOutlinedIcon,
  storm: ThunderstormOutlinedIcon,
};

const Divider = () => <span aria-hidden className="self-stretch w-px" style={{ background: "var(--border)" }} />;

/**
 * The date, Colombo weather and LKR exchange rates as one slim chip in the greeting row — the
 * ambient context that used to fill a whole row of tall cards. Self-fetching; each part fails
 * soft (a source that can't be reached is simply left out, never faked). The market news that
 * sat beside them is already covered by the Market Pulse ticker on the same page.
 */
export default function AmbientStrip() {
  const [rates, setRates] = useState<LkrRates | null>(null);
  const [weather, setWeather] = useState<WeatherNow | null>(null);

  useEffect(() => {
    fetchLkrRates().then(setRates);
    fetchColomboWeather().then(setWeather);
  }, []);

  const WeatherIcon = weather ? WEATHER_ICON[weather.icon] : WbSunnyOutlinedIcon;
  const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <div
      className="flex items-center flex-wrap gap-x-4 gap-y-1.5 px-3.5 py-2 rounded-[var(--radius-lg)] border border-border text-[12.5px]"
      style={{ background: "var(--surface)", color: "var(--text-muted)" }}
    >
      <span className="flex items-center gap-2">
        <CalendarTodayOutlinedIcon sx={{ fontSize: 15 }} />
        <span className="font-semibold" style={{ color: "var(--text-strong)" }}>
          {new Date().toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
        </span>
      </span>

      {weather && (
        <>
          <Divider />
          <span className="flex items-center gap-1.5" title={`Colombo — ${weather.label}`}>
            <WeatherIcon sx={{ fontSize: 16 }} />
            <span className="font-mono font-semibold" style={{ color: "var(--text-strong)" }}>
              {Math.round(weather.tempC)}°C
            </span>
            <span>{weather.label}</span>
          </span>
        </>
      )}

      {rates && (
        <>
          <Divider />
          <span className="flex items-center gap-3" title="Rupees per unit of foreign currency">
            {(
              [
                ["USD", rates.usd],
                ["GBP", rates.gbp],
                ["EUR", rates.eur],
              ] as const
            ).map(([code, value]) => (
              <span key={code}>
                {code}{" "}
                <span className="font-mono font-semibold" style={{ color: "var(--text-strong)" }}>
                  {fmt(value)}
                </span>
              </span>
            ))}
          </span>
        </>
      )}
    </div>
  );
}
