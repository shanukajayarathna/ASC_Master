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
  // Launchpad module tiles (frontend/src/components/shell/nav.ts) reference specific,
  // verified Unsplash CDN photos for their artwork. next/image needs the remote host
  // allow-listed; Unsplash's own image-resizing query params (w/q/fm/fit) are used
  // directly rather than duplicating that logic in next/image's own optimizer.
  images: {
    remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }],
  },
};

export default nextConfig;
