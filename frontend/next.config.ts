import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  // Self-contained server bundle (frontend/Dockerfile copies only .next/standalone + static
  // assets into the runtime image) — doesn't change `next dev`/`next start` behavior at all,
  // only what `next build` additionally emits.
  output: "standalone",
  // The LibreOffice routes invoke a system binary and only need their compiled route code;
  // they do not read source files, sale data, or public media at runtime. Keep those broad
  // directories out of the standalone trace while explicitly retaining each route entrypoint.
  outputFileTracingIncludes: {
    "/api/reports/xlsx-to-pdf": ["./src/app/api/reports/xlsx-to-pdf/route.ts"],
    "/api/weekly-fact/pdf": ["./src/app/api/weekly-fact/pdf/route.ts"],
  },
  outputFileTracingExcludes: {
    "/api/reports/xlsx-to-pdf": ["./src/**/*", "./public/**/*", "./data/**/*"],
    "/api/weekly-fact/pdf": ["./src/**/*", "./public/**/*", "./data/**/*"],
  },
  // Pin the workspace root explicitly: the repo root now also has a package-lock.json
  // (for the `concurrently`-based `npm run dev` that starts both frontend and backend),
  // which otherwise makes Turbopack guess wrong about which directory is the app root.
  turbopack: {
    root: path.join(__dirname),
  },
  // Lets the dev server's JS/HMR bundles load when reached over LAN (e.g. testing on a
  // phone at the host machine's IP) instead of being blocked as a cross-origin dev request.
  allowedDevOrigins: ["192.168.40.19"],
  // Launchpad module tiles (frontend/src/components/shell/nav.ts) reference specific,
  // verified Unsplash CDN photos for their artwork. next/image needs the remote host
  // allow-listed; Unsplash's own image-resizing query params (w/q/fm/fit) are used
  // directly rather than duplicating that logic in next/image's own optimizer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
  // Baseline browser hardening for every page: no framing (clickjacking), no MIME sniffing, no referrer leakage,
  // no camera/mic/location, and HTTPS-only once served over TLS (browsers ignore HSTS on plain http://localhost).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // Report-only: browsers log (never block) anything a stricter policy would stop, so it can be tightened safely
          // from real traffic before being enforced. Scripts/styles stay 'unsafe-inline' because Next and MUI inject some.
          {
            key: "Content-Security-Policy-Report-Only",
            value:
              "default-src 'self'; img-src 'self' data: blob: https://images.unsplash.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' http://localhost:* https:; frame-ancestors 'none'; object-src 'none'; base-uri 'self'",
          },
          { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
        ],
      },
    ];
  },
};

export default nextConfig;
