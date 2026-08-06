// Colombo, Sri Lanka — fixed, since that's where the business is. Open-Meteo is free and
// keyless (no signup, no API key to provision), CORS-enabled for direct browser calls.
const COLOMBO = { lat: 6.9271, lon: 79.8612 };

export interface WeatherNow {
  tempC: number;
  label: string;
  icon: "sun" | "cloud-sun" | "cloud" | "rain" | "storm";
}

// WMO weather codes (what Open-Meteo returns) collapsed to the handful of states worth
// showing at a glance — see https://open-meteo.com/en/docs for the full table.
function describe(code: number): { label: string; icon: WeatherNow["icon"] } {
  if (code === 0) return { label: "Clear sky", icon: "sun" };
  if (code <= 2) return { label: "Partly cloudy", icon: "cloud-sun" };
  if (code === 3) return { label: "Overcast", icon: "cloud" };
  if (code >= 51 && code <= 67) return { label: "Rain", icon: "rain" };
  if (code >= 80 && code <= 82) return { label: "Showers", icon: "rain" };
  if (code >= 95) return { label: "Thunderstorm", icon: "storm" };
  if (code >= 71 && code <= 77) return { label: "Rain", icon: "rain" };
  return { label: "Cloudy", icon: "cloud" };
}

/** Null on any failure (offline, blocked, timeout) — callers hide the widget rather than
 *  show a broken or stale reading. */
export async function fetchColomboWeather(): Promise<WeatherNow | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${COLOMBO.lat}&longitude=${COLOMBO.lon}&current=temperature_2m,weather_code&timezone=Asia%2FColombo`,
      { signal: controller.signal }
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    const tempC = data?.current?.temperature_2m;
    const code = data?.current?.weather_code;
    if (typeof tempC !== "number" || typeof code !== "number") return null;
    return { tempC, ...describe(code) };
  } catch {
    return null;
  }
}
