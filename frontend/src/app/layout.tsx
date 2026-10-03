import { LITE_MODE_SCRIPT, LiteMotion } from "@/lib/liteMode";
import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
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
const fraunces = localFont({
  variable: "--font-fraunces",
  src: [
    { path: "../../public/fonts/fraunces-600.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/fraunces-700.ttf", weight: "700", style: "normal" },
  ],
});

const plexSans = localFont({
  variable: "--font-plex-sans",
  src: [
    { path: "../../public/fonts/ibm-plex-sans-400.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/ibm-plex-sans-500.ttf", weight: "500", style: "normal" },
    { path: "../../public/fonts/ibm-plex-sans-600.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/ibm-plex-sans-700.ttf", weight: "700", style: "normal" },
  ],
});

const plexMono = localFont({
  variable: "--font-plex-mono",
  src: [
    { path: "../../public/fonts/ibm-plex-mono-400.ttf", weight: "400", style: "normal" },
    { path: "../../public/fonts/ibm-plex-mono-600.ttf", weight: "600", style: "normal" },
    { path: "../../public/fonts/ibm-plex-mono-700.ttf", weight: "700", style: "normal" },
  ],
});

export const metadata: Metadata = {
  title: "Intelligence Hub for Smart Asia Siyaka",
  description: "Asia Siyaka Commodities — Intelligence Hub for lot management, valuation & business intelligence",
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
      <head>
        <script dangerouslySetInnerHTML={{ __html: LITE_MODE_SCRIPT }} />
      </head>
      <body className="min-h-full">
        <PwaRegister />
        <ThemeRegistry>
          {/* Outside AuthProvider/the (app) gate on purpose — it also covers the
              login → dashboard redirect, not just navigation inside the authed app. */}
          <NavigationLoader />
          {/* Every real page lives under the (app) route group, which gates on this and
              adds CatalogueProvider/Shell itself — /login stays outside both so a signed-out
              visitor never renders (or fetches) any of the app's data. */}
          <LiteMotion>
            <AuthProvider>{children}</AuthProvider>
          </LiteMotion>
        </ThemeRegistry>
      </body>
    </html>
  );
}
