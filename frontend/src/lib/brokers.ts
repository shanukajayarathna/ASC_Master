/**
 * Broker identity — the company's own short codes and slicer colours (matched from the
 * Power BI portal's broker donut). Data still keys on the MSL file codes (AS, BTL, …);
 * everything user-facing shows these short codes and colours instead. Colour follows the
 * broker permanently — FW is always blue no matter how a filter reorders sizes.
 */
export interface BrokerIdentity {
  /** Company short code shown everywhere (portal convention). */
  code: string;
  name: string;
  color: string;
  /** Slightly lifted variants so dark surfaces keep ≥3:1 contrast. */
  colorDark: string;
}

export const BROKERS: Record<string, BrokerIdentity> = {
  AS: { code: "ASC", name: "Asia Siyaka", color: "#17A2B8", colorDark: "#2BC4DB" },
  BTL: { code: "BC", name: "Bartleet & Co", color: "#6F42C1", colorDark: "#8A63D2" },
  DES: { code: "CT", name: "Ceylon Tea Brokers", color: "#D6338F", colorDark: "#E45CA8" },
  EB: { code: "EB", name: "Eastern Brokers", color: "#1E7145", colorDark: "#2E9E63" },
  FBS: { code: "FW", name: "Forbes & Walker", color: "#2E86DE", colorDark: "#4D9BEB" },
  JK: { code: "JK", name: "John Keells", color: "#D63031", colorDark: "#E46262" },
  LCB: { code: "LC", name: "Lanka Commodity", color: "#E67E22", colorDark: "#F08A3C" },
  MB: { code: "MPB", name: "Mercantile Produce", color: "#F0B429", colorDark: "#F0B429" },
};

export function brokerCode(mslCode: string | null | undefined): string {
  if (!mslCode) return "—";
  return BROKERS[mslCode]?.code ?? mslCode;
}

export function brokerName(mslCode: string | null | undefined): string | null {
  return mslCode ? (BROKERS[mslCode]?.name ?? null) : null;
}

/** CSS custom property carrying the broker colour, theme-aware (set by BrokerPalette). */
export function brokerColorVar(mslCode: string | null | undefined): string {
  return mslCode && BROKERS[mslCode] ? `var(--broker-${mslCode})` : "var(--brand-gold)";
}

/** Inline <style> that defines --broker-XX for light + dark themes. Mount once per page. */
export function brokerPaletteCss(): string {
  const light = Object.entries(BROKERS).map(([k, b]) => `--broker-${k}: ${b.color};`).join(" ");
  const dark = Object.entries(BROKERS).map(([k, b]) => `--broker-${k}: ${b.colorDark};`).join(" ");
  return `:root { ${light} } :root[data-theme="dark"] { ${dark} }`;
}

/** MSL code keyed by company short code (ASC, BC, CT, ...) — the reverse of BrokerIdentity.code,
 *  for reports whose own data (e.g. Shared Mark Catalogues %, read off /data/sales' "Broker"
 *  column) already comes back in the short-code form rather than the MSL file code. */
const MSL_CODE_BY_SHORT_CODE: Record<string, string> = Object.fromEntries(
  Object.entries(BROKERS).map(([mslCode, b]) => [b.code, mslCode]),
);

export function brokerColorVarByShortCode(shortCode: string | null | undefined): string {
  const mslCode = shortCode ? MSL_CODE_BY_SHORT_CODE[shortCode.toUpperCase()] : undefined;
  return mslCode ? `var(--broker-${mslCode})` : "var(--brand-gold)";
}

/** Canonical broker column order (the portal donut's own order) — filter this down to whichever
 *  short codes a report's data actually contains, rather than sorting alphabetically, so a
 *  broker's column position stays stable across reports. */
export const BROKER_SHORT_CODES_ORDERED: string[] = Object.values(BROKERS).map((b) => b.code);
