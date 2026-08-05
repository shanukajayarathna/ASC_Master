import type { MetadataRoute } from "next";

/**
 * Makes the app installable (Add to Home Screen / desktop install prompt). Icons mirror
 * icon.svg's already-established design (ivory ground, gold "S", olive/gold rule) rather than
 * inventing a new mark — see frontend/public/icons/. Colors match globals.css's brand tokens
 * (--brand-olive / --ink-solid-900).
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "ASC Intelligence Hub",
    short_name: "ASC Hub",
    description: "Asia Siyaka Commodities — Tea Auction Lot Management, Valuation & Business Intelligence",
    start_url: "/dashboard",
    display: "standalone",
    background_color: "#F7F3E8",
    theme_color: "#14180B",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/icon-192-maskable.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
