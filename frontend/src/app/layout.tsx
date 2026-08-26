import type { Metadata, Viewport } from "next";
import { Fraunces, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import ThemeRegistry from "@/theme/ThemeRegistry";
import { AuthProvider } from "@/context/AuthContext";
import PwaRegister from "@/components/shared/PwaRegister";
import NavigationLoader from "@/components/shell/NavigationLoader";

// Weight lists are trimmed to what's actually referenced in the app (checked across every
// .tsx file for font-display/font-mono paired with a Tailwind weight class, plus every
// numeric fontWeight in an sx prop) — fewer weight files to fetch/parse on a slow connection
// or weak device, with no visual change. Re-check with the same sweep before adding a new
// bold/black usage of Fraunces or Plex Mono elsewhere in the app.
const fraunces = Fraunces({
  variable: "--font-fraunces",
  subsets: ["latin"],
  weight: ["600", "700"],
});

const plexSans = IBM_Plex_Sans({
  variable: "--font-plex-sans",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  // 700 added for the Top Price Page bulletin's bold grade/price columns (TopPriceBulletin.
  // module.css) — without a real 700 file, the browser synthesizes bold from 600, which
  // html2canvas's PDF export renders visibly worse than the on-screen preview.
  weight: ["400", "600", "700"],
});

export const metadata: Metadata = {
  title: "ASC — Tea Auction Valuation & Business Intelligence Platform",
  description: "Asia Siyaka Commodities — Tea Auction Lot Management, Valuation & Business Intelligence",
  appleWebApp: {
    capable: true,
    title: "ASC Hub",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Extend under display cutouts (notch/Dynamic Island) — the shell pads itself back out
  // with env(safe-area-inset-*) (.app-topbar/.app-main-safe in globals.css), so the topbar
  // surface fills the cutout band instead of showing a letterboxed stripe.
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#717C21" },
    { media: "(prefers-color-scheme: dark)", color: "#16181D" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${plexSans.variable} ${plexMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full">
        <PwaRegister />
        <ThemeRegistry>
          {/* Outside AuthProvider/the (app) gate on purpose — it also covers the
              login → dashboard redirect, not just navigation inside the authed app. */}
          <NavigationLoader />
          {/* Every real page lives under the (app) route group, which gates on this and
              adds CatalogueProvider/Shell itself — /login stays outside both so a signed-out
              visitor never renders (or fetches) any of the app's data. */}
          <AuthProvider>{children}</AuthProvider>
        </ThemeRegistry>
      </body>
    </html>
  );
}
