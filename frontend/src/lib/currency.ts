// LKR is the currency every domestic tea-auction figure is quoted in, so USD/GBP/EUR are
// shown as "how many LKR does this buy" — the direction a broker actually thinks in, not the
// inverse. open.er-api.com is free and keyless (no signup, no API key to provision, CORS-
// enabled for direct browser calls) — same sourcing rationale as lib/weather.ts's Open-Meteo.
export interface LkrRates {
  usd: number;
  gbp: number;
  eur: number;
  updatedAt: string;
}

/** Null on any failure (offline, blocked, timeout, or a currency missing from the response) —
 *  callers hide the widget rather than show a broken or stale reading, same convention as
 *  fetchColomboWeather. */
export async function fetchLkrRates(): Promise<LkrRates | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4000);
    const res = await fetch("https://open.er-api.com/v6/latest/USD", { signal: controller.signal });
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.result !== "success") return null;
    const rates = data?.rates;
    const usdToLkr = rates?.LKR;
    const usdToGbp = rates?.GBP;
    const usdToEur = rates?.EUR;
    if (typeof usdToLkr !== "number" || typeof usdToGbp !== "number" || typeof usdToEur !== "number") return null;
    return {
      usd: usdToLkr,
      gbp: usdToLkr / usdToGbp,
      eur: usdToLkr / usdToEur,
      updatedAt: data.time_last_update_utc ?? new Date().toISOString(),
    };
  } catch {
    return null;
  }
}
